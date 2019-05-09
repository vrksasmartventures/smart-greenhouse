/* Actuator Node Code for IOT Greenhouse
   09.21.2015
*/

var mraa = require("mraa"); //require mraa
var mqtt = require('mqtt');
var fs = require('fs');

console.log('MRAA Version: ' + mraa.getVersion()); //write the mraa version to the Intel XDK console
 

var FanPin = new mraa.Gpio(1);
var LightPwmPin = new mraa.Pwm(3); //3, 5, 6, 9
var MisterPin = new mraa.Gpio(2);
var ActuatorPin = new mraa.Gpio(7);

var SPI = new mraa.Spi(0);
SPI.mode(0);
SPI.lsbmode(true);
SPI.frequency(500000);
SPI.bitPerWord(8);

var LEDStrip = require('./ledstrip.js');
var leds = new LEDStrip(SPI, 153);
leds.setup();

LightPwmPin.enable(true);
LightPwmPin.period_us(3000); //2000
 

var value = 0;
var CurrentLightValue = 0.0;
var PreviousLightValue = 0.0;

//OverheadLightPin.dir(mraa.DIR_OUT);
FanPin.dir(mraa.DIR_OUT);
MisterPin.dir(mraa.DIR_OUT);
ActuatorPin.dir(mraa.DIR_OUT);

//OverheadLightPin.write(1);
 

/* Set output power-on states */
writeFan(0);
writeMister(0);
writeVent(0);
writeOverheadLight('0.0');
leds.fill([0,0,0]);

function writeOverheadLight(RequestedLightValue) {
  console.log("Setting Overhead Light intensity " + RequestedLightValue);

  var iv = setInterval(function () {
    if (CurrentLightValue >= RequestedLightValue) {
      CurrentLightValue -= 0.01;
    } else if (CurrentLightValue < RequestedLightValue) {
      CurrentLightValue += 0.01;
    } else {
      CurrentLightValue = 0.0;
    }

    CurrentLightValue = +CurrentLightValue.toFixed(2);

    //console.log(CurrentLightValue)
    LightPwmPin.write(CurrentLightValue);

    if (CurrentLightValue == RequestedLightValue) clearInterval(iv);

  }, 10);
}

function readOverheadLight() {
  return parseFloat(LightPwmPin.read());
}

function writeLEDStrip(red, green, blue) {
  //console.log("red:" + red);
  //console.log("green:" + green);
  //console.log("blue:" + blue);
  //process.nextTick(function() {;
  //setImmediate(function() {
    leds.fill([parseInt(red), parseInt(green), parseInt(blue)]);
  //});
}

function readLEDStrip() {
  var resp = {};
  resp.Red = 0.0;
  resp.Green = 0.0;
  resp.Blue = 0.0;
  return resp;
}

function writeFan(Value) {
  if (Value == '1') { Value = '0' } else { Value = '1'; }
  FanPin.write(parseInt(Value));
}

function readFan(){
  var Value = FanPin.read();  
  if (Value == '1') { Value = '0' } else { Value = '1'; }
  return parseInt(Value);
}

function writeMister(Value) {
  if (Value == '1') { Value = '0' } else { Value = '1'; }
  MisterPin.write(parseInt(Value));
}

function readMister(){
  var Value =  MisterPin.read();
  if (Value == '1') { Value = '0' } else { Value = '1'; }
  return parseInt(Value);
}

function writeVent(Value) {
  //console.log(parseInt(Value));
  if (Value == '1') { Value = '0' } else { Value = '1'; }
  ActuatorPin.write(parseInt(Value));
}

function readVent(){
  var Value = ActuatorPin.read();
  if (Value == '1') { Value = '0' } else { Value = '1'; }
  return parseInt(Value);
}

// ssl cert config
var icebreakerCirtsDir = __dirname + '/certs/icebreaker';

var options = {
  key: fs.readFileSync(icebreakerCirtsDir + '/iot-greenhouse-private.crt'),
  cert: fs.readFileSync(icebreakerCirtsDir + '/iot-greenhouse.pem'),
  ca: [fs.readFileSync(icebreakerCirtsDir + '/rootCA.pem')],
  requestCert: true,
  rejectUnauthorized: true,
  port: 8883
};

console.log("Connecting to AWS MQTT server...");

var client  = mqtt.connect('mqtts://data.iot.us-east-1.amazonaws.com',options);
client.on('connect', function () {
  console.log("Connected to Icebreaker");

  var actuatorTopicPrefix = 'IOTGreenhouse/Actuators/';
  var actuator_topics = ["Lights/OverheadLamps/Lamp1", "Lights/LEDLamps/Strip1", "Fans/VentilationFans/Fan1",
    "Sprinklers/Misters/Mister1", "Windows/Vents/Vent1", "Windows/Vents/Vent2"];

  var mqttSubscriptionTopics = {};
  actuator_topics.map(function(topic) { mqttSubscriptionTopics[actuatorTopicPrefix + topic] = 1; });

  client.subscribe(mqttSubscriptionTopics);
});

client.on('message', subscribeCallback);

client.on('error', function (err) {
  console.log('Error Connecting to IceBreaker ' + err);
});

var dataSource = 'IOTGreenhouse';

function subscribeCallback(mqttTopic, mqttMessage) {
  var topicParts = mqttTopic.split('/');
  if(topicParts.length > 3) {
    var partIndex = 0;
    if(topicParts[partIndex] == dataSource) {
      partIndex++;
      if(topicParts[partIndex] == 'Actuators') {
        partIndex++;
        try {
          var commandObject = JSON.parse(mqttMessage);
          if(commandObject) {
            executeActuatorCommand(topicParts, commandObject, function(responseObject) {
              // Publish response on status channel
              var publishTopic = mqttTopic.replace('/Actuators', '/Actuators/Status');
              client.publish(publishTopic, JSON.stringify(responseObject));
            });
          } else {
            console.log('Received incorrect message ' + mqttMessage);
          }
        } catch (err) {
          console.log("received invalid mqtt JSON message, Error " + err);
        }
      } else {
        console.log('Ignoring invalid MQTT device type ' + topicParts[partIndex]);
      }
    } else {
      console.log('Ignoring message from non supported MQTT source ' + topicParts[partIndex]);
    }
  } else {
    console.log('Received incomplete MQTT topic ' + mqttTopic);
  }
}

function executeActuatorCommand(topicParts, commandObject, callback) {
  console.log('Actuator ' + topicParts[topicParts.length - 1] + ' Command ' + JSON.stringify(commandObject));
  if(!commandObject.state) {
    console.log("Received invalid command" + JSON.stringify(commandObject));
  }
  switch (topicParts[topicParts.length - 1]) {
    case "Lamp1":    		//Overhead light
      executeOverheadLightCommand(commandObject, callback);
      break;
    case "Strip1":		//RGB Pixel Strip
      executeLEDStripCommand(commandObject, callback);
      break;
    case "Fan1":        	//Fan
      executeFanCommand(commandObject, callback);
      break;
    case "Mister1":			//Mister
      executeMisterCommand(commandObject, callback);
      break;
    case "Vent1":			//Window Vent
      executeVentCommand(commandObject, callback);
      break;

  }
}

function executeOverheadLightCommand(commandObject, callback) {
  var command = commandObject.state;
  var intensity = 0.0;
  if(commandObject.state ==='on') {
    intensity = 1.0;
    if(commandObject.intensity) {
      intensity = commandObject.intensity;
    }
  }
  writeOverheadLight(intensity);

  // Read Value after 1 sec
  setTimeout(function() {
    var respIntensity = readOverheadLight();
    var responseObject = { reading_timestamp : new Date().getTime() };
    responseObject.state = respIntensity ? "on" : "off";
    responseObject.intensity = respIntensity;
    callback(responseObject)
  }, 2000);
}

function executeLEDStripCommand(commandObject, callback) {
  var redIntensity = 0;
  var greenIntensity = 0;
  var blueIntensity = 0;
  if (commandObject.state === 'on') {
    if (commandObject.redIntensity) redIntensity = commandObject.redIntensity;
    if (commandObject.greenIntensity) greenIntensity = commandObject.greenIntensity;
    if (commandObject.blueIntensity) blueIntensity = commandObject.blueIntensity;
  }
  writeLEDStrip(redIntensity, greenIntensity, blueIntensity);
  // Read Value after .5 sec
  setTimeout(function() {
    var resp = readLEDStrip();
    var responseObject = { reading_timestamp : new Date().getTime() };
    responseObject.state = resp.Red || resp.Green || resp.Blue ? "on" : "off";
    responseObject.redIntensity = resp.Red;
    responseObject.greenIntensity = resp.Green;
    responseObject.blueIntensity = resp.Blue;
    callback(responseObject);
  }, 500);

}

function executeFanCommand(commandObject, callback) {
  var command = commandObject.state;
  writeFan(commandObject.state ==='on' ? 1 : 0);

  // Read Value after 3 sec
  setTimeout(function() {
    var responseObject = { reading_timestamp : new Date().getTime() };
    responseObject.state = readFan() ? "on" : "off";
    callback(responseObject)
  }, 3000);
}

function executeMisterCommand(commandObject, callback) {
  var command = commandObject.state;
  writeMister(commandObject.state ==='on' ? 1 : 0);

  // Read Value after 2 sec
  setTimeout(function() {
    var responseObject = { reading_timestamp : new Date().getTime() };
    responseObject.state = readMister() ? "on" : "off";
    callback(responseObject)
  }, 2000);
}

function executeVentCommand(commandObject, callback) {
  var command = commandObject.state;
  writeVent(commandObject.state ==='open' ? 1 : 0);

  // Read Value after 5 sec
  setTimeout(function() {
    var responseObject = { reading_timestamp : new Date().getTime() };
    responseObject.state = readVent() ? "open" : "close";
    callback(responseObject)
  }, 10000);
}
 
 
 

process.on('SIGINT', function() {
  var ForceOff = new mraa.Gpio(3);
  ForceOff.dir(mraa.DIR_OUT);
  ForceOff.write(0);
  //LightPwmPin.write(0.0);
  leds.fill([0,0,0]);
  process.exit(0);
});
 
 