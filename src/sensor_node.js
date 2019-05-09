/*
IOT Greenhouse Sensor Node Code
*/

var mraa = require('mraa'); //require mraa
console.log('MRAA Version: ' + mraa.getVersion()); //write the mraa version to the Intel XDK console
var mqtt = require('mqtt');
var fs = require('fs');



var myOnboardLed = new mraa.Gpio(13); //LED hooked up to digital pin 13 (or built in pin on Intel Galileo Gen2 as well as Intel Edison)
myOnboardLed.dir(mraa.DIR_OUT);

var LightSensorPin = new mraa.Aio(0);
var HumiditySensorPin = new mraa.Aio(1);
var SoilSensorPin = new mraa.Aio(2);
var TempSensorPin = new mraa.Aio(3);


var B = 3975;
var LoopInterval = null;
var CollectingData = false;

// ssl cert config
var icebreakerCirtsDir = __dirname + '/certs/icebreaker';

var options = {
  key: fs.readFileSync(icebreakerCirtsDir + '/iot-greenhouse-private.crt'),
  cert: fs.readFileSync(icebreakerCirtsDir + '/iot-greenhouse.pem'),
  ca: [fs.readFileSync(icebreakerCirtsDir + '/rootCA.pem')],
  requestCert: true,
  rejectUnauthorized: true,
  port: 8883,
  cleanSession: true,
  //reconnectPeriod: 2000,
  //connectTimeout: 2000,
  protocolId: 'MQIsdp',
  protocolVersion: 3
};

var client  = mqtt.connect('mqtts://data.iot.us-east-1.amazonaws.com',options);

console.log("Connecting to AWS MQTT server...");
client.on('connect', function onConnect(data) {
  console.log("Connected: " + data);

  //only restart the sensor watch if it is not running. This has to do with the setinterval not
  //being cleared correctly on error
  if (CollectingData == false) {
    startSensorWatch(); 
  }
});

//Emitted only when the client can't connect on startup
client.on('error', function (err) {  
  console.log('Error connecting to IceBreaker ' + err); 
});

//Emitted after a disconnection
client.on('offline', function () {
  console.log('IceBreaker connection lost or WiFi down.'); 
  clearInterval(LoopInterval);
});

//Emitted after a closed connection
client.on('close', function () {
  console.log('IceBreaker connection closed.'); 
  clearInterval(LoopInterval);
});

//Emitted after a reconnection
client.on('reconnect', function () {
  console.log('IceBreaker connection restored.'); 
  startSensorWatch();
});

/*
Function: startSensorWatch(client)
Parameters: client - mqtt client communication channel
Description: Read Sensor Data on timer event and send it to AWS IOT
*/
//function startSensorWatch(client) {
function startSensorWatch() {
    'use strict';

    var Sensor1Success = false;
    var Sensor2Success = false;
    var Sensor3Success = false;
    var Sensor4Success = false;

    LoopInterval = setInterval(function () {

        myOnboardLed.write(1);
        CollectingData = true;
        
  
        var LightSensorValue = LightSensorPin.read();

        var HumiditySensorValue = HumiditySensorPin.read();
        var HumiditySensorPercentage = SensorMap(HumiditySensorValue,200,700,0,100);

        var TempSensorValue = TempSensorPin.read();
        var TempSensorMilliVolts = (TempSensorValue * (5000 / 1024)); //for 5v AVREF
        var CentigradeTemp = (TempSensorMilliVolts - 500) / 10;
        var fahrenheit_temperature = (((CentigradeTemp * 9) / 5) + 32).toFixed(2);


        var message = {reading_timestamp:new Date().getTime(), luminosity:LightSensorValue};
        client.publish('IOTGreenhouse/Sensors/Luminance/Sensor1', JSON.stringify(message), {
        }, function() {
          //console.log("luminosity: " + LightSensorValue); 
          Sensor1Success = true;
        }); 

        var message = {reading_timestamp:new Date().getTime(), humidity:HumiditySensorPercentage};
        client.publish('IOTGreenhouse/Sensors/Humidity/Air/Sensor1', JSON.stringify(message), { 
        }, function() {
          console.log("humidity: " + HumiditySensorPercentage); 
          Sensor2Success = true;
        });

        var message = {reading_timestamp:new Date().getTime(), temperature:fahrenheit_temperature};
        client.publish('IOTGreenhouse/Sensors/Temperature/Sensor1', JSON.stringify(message), { 
        }, function () { 
          
          Sensor3Success = true;
        });


        //Only flash the heartbeat indicator if all sensors read correctly
        //if not, leave it on solid
        if (Sensor1Success && Sensor2Success && Sensor3Success) {
        //if (Sensor4Success) {
          myOnboardLed.write(0);

          var Sensor1Success = false;
          var Sensor2Success = false;
          var Sensor3Success = false;
          var Sensor4Success = false;

        }
 

    }, 1000);

}

function SensorMap(x, in_min, in_max, out_min, out_max)
{
  return Math.round((x - in_min) * (out_max - out_min) / (in_max - in_min) + out_min);
}
 

process.on('SIGINT', function() {
    console.log("Received Interrupt, Exiting...");
    clearInterval(LoopInterval);
    client.end();     
    process.exit(0);
});
 