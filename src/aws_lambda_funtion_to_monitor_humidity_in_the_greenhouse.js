/**
 * Created by atulbar on 9/25/15.
 */
console.log('Loading function');
var nconf = require('nconf');
var AWS = require('aws-sdk');

//Setup nconf to use (in-order):
// 1. Command-line arguments,
// 2. Environment variables
// 3. A file located at 'path/to/config.json'
nconf.argv().env().file({ file: __dirname + '/air-humidity-monitor-config.json' });
// nconf.argv().env().file({ file: __dirname + '/temperature-monitor-config.json' });

// create IceBreaker Mqtt Client and connect it to the server
var icebreakerMqttClient = require('./icebreaker-mqtt-client');
icebreakerMqttClient.connect();

var docClient = new AWS.DynamoDB.DocumentClient({region: nconf.get('aws_region')});
 

console.log('Settings ' + JSON.stringify(nconf.get(), null, 2) );

var MEASUREMENT = nconf.get('measurement');
var MEASUREMENT_HIGH_THRESHOLD = nconf.get('measurement_high_threshold'); // measurement high threshold
var MEASUREMENT_LOW_THRESHOLD = nconf.get('measurement_low_threshold'); // measurement low threshold
var EVALUATION_DURATION = nconf.get('evaluation_duration'); // duration for evaluation of trigger in seconds
var MEASUREMENT_SENSOR = nconf.get('measurement_sensor');
var HIGH_THRESHOLD_ALARM_ACTIONS = nconf.get('high_threshold_alarm_actions');
var LOW_THRESHOLD_ALARM_ACTIONS = nconf.get('low_threshold_alarm_actions');

var ALARM_TABLE_NAME = nconf.get('alarm_table_name') || 'IOTGreenhouse_alarms';

var dataSource = nconf.get('mode');
var sensorTopicPrefix = dataSource + '/Sensors/';
var sensors = nconf.get('sensors');
var actuators = nconf.get('actuators');

var MEASUREMENT_SENSOR_ID;
if(sensors) {
    MEASUREMENT_SENSOR_ID = sensorTopicPrefix + sensors[MEASUREMENT_SENSOR];
}

exports.handler = function(event, context) {
    // console.log('Received event:', JSON.stringify(event, null, 2));
    if( ! MEASUREMENT_SENSOR_ID ) failWithMessage('No Sensor is configured');
    if( ! event[MEASUREMENT] ) failWithMessage('Incorect event received');

    readCurrentAlarmState(function(err, alarmState) {
        if( err ) failWithMessage('Failed to read alarm state due to error ' + err);

        if( ! alarmState.processing ) { // alarm is off
            if( crossedHighThreshold(event) ) { // crossed threshold for first time
                initializeAlarmProcessing(true, function (err) {
                    if (err) failWithMessage('Failed to initialize alarm processing due to error ' + err);
                    context.succeed();
                });
            } else if( crossedLowThreshold(event) ) { // crossed threshold for first time
                initializeAlarmProcessing(false, function(err) {
                    if(err) failWithMessage('Failed to initialize alarm processing due to error ' + err);
                    context.succeed();
                });
            } else {
                context.succeed();  // threshold not reached
            }
        } else { // alarm was  processing
            if( !(alarmState.highThreshold) && crossedHighThreshold(event) ) { // crossed other threshold
                initializeAlarmProcessing(true, function (err) {
                    if (err) failWithMessage('Failed to initialize alarm processing due to error ' + err);
                    context.succeed();
                });
            } else if( alarmState.highThreshold && crossedLowThreshold(event) ) { // crossed threshold for first time
                initializeAlarmProcessing(false, function(err) {
                    if(err) failWithMessage('Failed to initialize alarm processing due to error ' + err);
                    context.succeed();
                });
            } else if(droppedBackWithinTolerance(event, alarmState)) { // we dropped back within tolerance
                console.log(MEASUREMENT + ' back within tolerance, clearing alarm processing');
                clearAlarmProcessing(function(err){
                    if(err) failWithMessage('Failed to clear alarm state due to error ' + err);
                    context.succeed();
                });
            } else { // we continue to be above threshold
                alarmState.readingCount++;
                updateAlarmProcessing(alarmState, function(err){
                    if(err) failWithMessage('Failed to update alarm state due to error ' + err);
                    console.log('alarm reading count ' + alarmState.readingCount);
                    if( alarmState.readingCount > 2 )  { // at least 3 readings
                        var timeElapsedInSeconds = ( new Date().getTime() - alarmState.firstReadingTime ) / 1000;
                        if( timeElapsedInSeconds >  EVALUATION_DURATION ) {
                            fireAlarm(alarmState, function(err){
                                if(err) console.log('Failed to fire alarm state due to error ' + err);  // do not fail here, we need to clear alarm state
                                clearAlarmProcessing(function(errDb){
                                    if(errDb) failWithMessage('Failed to clear alarm state due to error ' + errDb );
                                    context.succeed();
                                });
                            });
                        } else {
                            context.succeed();  // within evaluation duration
                        }
                    } else {
                        context.succeed();  // not enough readings
                    }
                });
            }
        }
 
 
 

    });

    function crossedHighThreshold(event) {
        return event[MEASUREMENT] > MEASUREMENT_HIGH_THRESHOLD;
    }

    function crossedLowThreshold(event) {
        return event[MEASUREMENT] < MEASUREMENT_LOW_THRESHOLD;
    }

    function droppedBackWithinTolerance(event, alarmState) {
        if(alarmState.highThreshold) {
            return event[MEASUREMENT]  <= MEASUREMENT_HIGH_THRESHOLD;
        } else {
            return event[MEASUREMENT] >= MEASUREMENT_LOW_THRESHOLD;
        }
    }

    function failWithMessage(message) {
        console.log(message);
        context.fail(message);
    }

    function readCurrentAlarmState(callback) {
        var params = {
            TableName: ALARM_TABLE_NAME,
            Key: {
                sensor_id: MEASUREMENT_SENSOR_ID
            },
            ConsistentRead: true
        };
        docClient.get(params, function (err, data) {
            if(err) {
                callback(err);
            } else {
                var alarmState;
                if( ! data.Item ||  ! data.Item.alarmState) {
                    alarmState = { processing : false };
                } else {
                    alarmState = data.Item.alarmState;
                }
                callback(null, alarmState);
            }
        });
    }

    function updateAlarmProcessing(alarmState, callback) {
        var params = {
            TableName: ALARM_TABLE_NAME,
            Item: {
                sensor_id: MEASUREMENT_SENSOR_ID
            }
        };
        params.Item.alarmState = alarmState;
        docClient.put(params, callback);
    }

    function initializeAlarmProcessing(highThreshold, callback) {
        var alarmState = { processing : true, highThreshold : highThreshold, firstReadingTime : new Date().getTime(), readingCount : 1 };
        console.log('Initializing alarm processing state  ' + JSON.stringify(alarmState));
        updateAlarmProcessing(alarmState, callback);
    }

    function clearAlarmProcessing(callback) {
        var alarmState = { processing : false };
        console.log('clearing alarm processing ');
        updateAlarmProcessing(alarmState, callback);
    }

    function fireAlarm(alarmState, callback) {
        var alarmActions = alarmState.highThreshold ? HIGH_THRESHOLD_ALARM_ACTIONS : LOW_THRESHOLD_ALARM_ACTIONS;
        console.log('Firing alarm with state ' + JSON.stringify(alarmState, null, 2) + ' mqtt messages ' + JSON.stringify(alarmActions, null, 2));
        var publishPending = alarmActions.length;
        alarmActions.map( function(alarmAction) {
            icebreakerMqttClient.sendCommandToActuator(alarmAction.actuator, alarmAction.message, function(err) {
                if(--publishPending == 0) {
                    callback(err);
                }
            });
        });
    }

};