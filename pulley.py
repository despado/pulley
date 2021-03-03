import json
from configparser import ConfigParser
from liquidctl.driver.kraken2 import KrakenTwoDriver
from liquidctl.driver.kraken3 import KrakenZ3, KrakenX3
from time import sleep, monotonic
from elevate import elevate
from os import path
from numpy import interp
from pydbus import SystemBus
from gi.repository import GLib

from pydbus.generic import signal

class KrakenControllerConfig:
    def __init__(self):
        self.configFile = "/etc/pulley.conf"
        self.config = {
            'mode': "custom",
            'enable_dbus': True,
            'use_liquid_temp': False,
            'boost_duration': 60,
            'cpu_critical': 80,
            'liquid_critical': 40,
            'boost_after_critical': True,
            'fixed_fan_speed': 75,
            'fixed_pump_speed': 75,
            'cpu_fan_temp': [0, 30, 40, 50, 60, 70, 75],
            'cpu_fan_speed': [25, 25, 25, 25, 50, 75, 100],
            'cpu_pump_temp': [0, 30, 40, 50, 60, 70, 75],
            'cpu_pump_speed': [60, 60, 60, 60, 80, 90, 100],
            'liquid_fan_temp': [0, 35, 40],
            'liquid_fan_speed': [25, 25, 100],
            'liquid_pump_temp': [0, 35, 40],
            'liquid_pump_speed': [60, 60, 100]}

    def join_curve(self, x, y):
        if len(x) != len(y):
            raise Exception("Curve axis must be of equal size")
        result = [];
        for idx in range(len(x)):
            result.append([x[idx],y[idx]])
        return result

    def split_curve(self, curve):
        x = [];
        y = [];
        for p in curve:
            if len(p) != 2:
                raise Exception("Curves must be pairs of points")
            x.append(int(p[0]))
            y.append(int(p[1]))
        return { 'x': x, 'y': y }

    def writeValues(self, config_out, config, values):
        for value in values:
            if type(value) is list:
                config_out[value[0]] = config[value[1]]
            else:
                config_out[value] = config[value]
        return config_out

    def readConfig(self):
        config = ConfigParser();
        config.read(self.configFile)

        if 'pulley' in config:
            self.readValues(self.config, config['pulley'], ['mode', 'enable_dbus', 'use_liquid_temp', 'boost_duration', 'cpu_critical', 'liquid_critical', 'boost_after_critical'])

        if 'fixed' in config:
            self.readValues(self.config, config['fixed'], [['fan', 'fixed_fan_speed'], ['pump', 'fixed_pump_speed' ]])

        if 'custom' in config:
            curve_names = [ 'cpu_fan', 'cpu_pump', 'liquid_fan', 'liquid_pump' ];
            curves = {}
            curve_keys = []
            for curve_name in curve_names:
                curves[curve_name + "_curve"] = self.join_curve(self.config[curve_name + "_temp"], self.config[curve_name + "_speed"])
                curve_keys.append(curve_name + "_curve")

            self.readValues(curves, config['custom'], curve_keys)
            for curve_name in curve_names:
                curve = self.split_curve(curves[curve_name + "_curve"])
                self.config[curve_name + "_temp"] = curve['x']
                self.config[curve_name + "_speed"] = curve['y']

    def writeConfig(self):
        config = ConfigParser();
        config['pulley'] = self.writeValues({}, self.config, ['mode', 'enable_dbus', 'use_liquid_temp', 'boost_duration', 'cpu_critical', 'liquid_critical', 'boost_after_critical'])
        config['fixed'] = self.writeValues({}, self.config, [['fan', 'fixed_fan_speed'], ['pump', 'fixed_pump_speed' ]])

        curve_names = [ 'cpu_fan', 'cpu_pump', 'liquid_fan', 'liquid_pump' ];
        config['custom'] = {}
        for curve_name in curve_names:
            config['custom'][curve_name + "_curve"] = str(self.join_curve(self.config[curve_name + "_temp"], self.config[curve_name + "_speed"]))

        with open(self.configFile, "w") as configFile:
            config.write(configFile)

    def readValue_(self, config_out, section, name_in, name_out):
        if name_out in config_out:
            if type(config_out[name_out]) is bool:
                config_out[name_out] = section.getboolean(name_in, config_out[name_out])
            elif type(config_out[name_out]) is int:
                config_out[name_out] = section.getint(name_in, config_out[name_out])
            elif type(config_out[name_out]) is float:
                config_out[name_out] = section.getfloat(name_in, config_out[name_out])
            elif type(config_out[name_out]) is list:
                config_out[name_out] = json.loads(section.get(name_in, config_out[name_out]))
            else:
                config_out[name_out] = section.get(name_in, config_out[name_out])
        else:
            config_out[name_out] = section.get(name_in)

    def readValue(self, config_out, section, name):
        if type(name) is list:
            self.readValue_(config_out, section, name[0], name[1])
        else:
            self.readValue_(config_out, section, name, name)

    def readValues(self, config_out, section, names):
        for name in names:
            self.readValue(config_out, section, name)

    def toJSON(self):
        result = json.dumps({
            'mode': self.config['mode'],
            'use_liquid_temp': self.config['use_liquid_temp'],
            'boost_duration': self.config['boost_duration'],
            'cpu_critical': self.config['cpu_critical'],
            'liquid_critical': self.config['liquid_critical'],
            'boost_after_critical': self.config['boost_after_critical'],
            'fixed_fan_speed': self.config['fixed_fan_speed'],
            'fixed_pump_speed': self.config['fixed_pump_speed'],
            'cpu_pump_temp': self.config['cpu_pump_temp'],
            'cpu_pump_speed': self.config['cpu_pump_speed'],
            'cpu_fan_temp': self.config['cpu_fan_temp'],
            'cpu_fan_speed': self.config['cpu_fan_speed'],
            'liquid_pump_temp': self.config['liquid_pump_temp'],
            'liquid_pump_speed': self.config['liquid_pump_speed'],
            'liquid_fan_temp': self.config['liquid_fan_temp'],
            'liquid_fan_speed': self.config['liquid_fan_speed']
        });
        return result

    def parseJSON(self, rawConfigStr):
        rawConfig = json.loads(rawConfigStr)
        newConfig = {}
        newConfig['enable_dbus'] = self.config['enable_dbus']

        if "mode" in rawConfig and (rawConfig['mode'] == "fixed" or rawConfig['mode']=="custom"):
            newConfig['mode'] = str(rawConfig['mode'])
        else:
            return

        if "use_liquid_temp" in rawConfig and (rawConfig['use_liquid_temp'] == True or rawConfig['use_liquid_temp'] == False):
            newConfig['use_liquid_temp'] = bool(rawConfig['use_liquid_temp'])
        else:
            return

        if 'boost_duration' in rawConfig and (rawConfig['boost_duration'] >=0 and rawConfig['boost_duration'] <= 1800):
            newConfig['boost_duration'] = int(rawConfig['boost_duration'])
        else:
            return

        if "cpu_critical" in rawConfig and (rawConfig['cpu_critical'] >=0 and rawConfig['cpu_critical'] <= 150):
            newConfig['cpu_critical'] = int(rawConfig['cpu_critical'])
        else:
            return

        if "liquid_critical" in rawConfig and(rawConfig['liquid_critical'] >=0 and rawConfig['liquid_critical'] <= 150):
            newConfig['liquid_critical'] = int(rawConfig['liquid_critical'])
        else:
            return

        if 'boost_after_critical' in rawConfig and (rawConfig['boost_after_critical'] == True or rawConfig['boost_after_critical'] == False):
            newConfig['boost_after_critical'] = bool(rawConfig['boost_after_critical'])
        else:
            return

        if 'fixed_fan_speed' in rawConfig and (rawConfig['fixed_fan_speed'] >=0 and rawConfig['fixed_fan_speed'] <= 100):
            newConfig['fixed_fan_speed'] = int(rawConfig['fixed_fan_speed'])
        else:
            return

        if 'fixed_pump_speed' in rawConfig and (rawConfig['fixed_pump_speed'] >=0 and rawConfig['fixed_pump_speed'] <= 100):
            newConfig['fixed_pump_speed'] = int(rawConfig['fixed_pump_speed'])
        else:
            return
            
        if 'cpu_pump_temp' in rawConfig and 'cpu_pump_speed' in rawConfig and isinstance(rawConfig['cpu_pump_temp'], list) and isinstance(rawConfig['cpu_pump_speed'], list) and len(rawConfig['cpu_pump_temp'])>0 and len(rawConfig['cpu_pump_temp']) == len(rawConfig['cpu_pump_speed']):
            newConfig['cpu_pump_temp'] = []
            newConfig['cpu_pump_speed'] = []
            prev = 0
            for val in rawConfig['cpu_pump_temp']:
                if prev > int(val):
                    return
                if int(val) > 150:
                    return
                prev = int(val);
                newConfig['cpu_pump_temp'].append(int(val))

            prev = 0
            for val in rawConfig['cpu_pump_speed']:
                if prev > int(val):
                    return
                if int(val) > 100:
                    return
                prev = int(val);
                newConfig['cpu_pump_speed'].append(int(val))
        else:
            return

        if 'cpu_fan_temp' in rawConfig and 'cpu_fan_speed' in rawConfig and isinstance(rawConfig['cpu_fan_temp'], list) and isinstance(rawConfig['cpu_fan_speed'], list) and len(rawConfig['cpu_fan_temp'])>0 and len(rawConfig['cpu_fan_temp']) == len(rawConfig['cpu_fan_speed']):
            newConfig['cpu_fan_temp'] = []
            newConfig['cpu_fan_speed'] = []
            prev = 0
            for val in rawConfig['cpu_fan_temp']:
                if prev > int(val):
                    return
                if int(val) > 150:
                    return
                prev = int(val);
                newConfig['cpu_fan_temp'].append(int(val))

            prev = 0
            for val in rawConfig['cpu_fan_speed']:
                if prev > int(val):
                    return
                if int(val) > 100:
                    return
                prev = int(val);
                newConfig['cpu_fan_speed'].append(int(val))
        else:
            return

        if 'liquid_pump_temp' in rawConfig and 'liquid_pump_speed' in rawConfig and isinstance(rawConfig['liquid_pump_temp'], list) and isinstance(rawConfig['liquid_pump_speed'], list) and len(rawConfig['liquid_pump_temp'])>0 and len(rawConfig['liquid_pump_temp']) == len(rawConfig['liquid_pump_speed']):
            newConfig['liquid_pump_temp'] = []
            newConfig['liquid_pump_speed'] = []
            prev = 0;
            for val in rawConfig['liquid_pump_temp']:
                if prev > int(val):
                    return
                if int(val) > 150:
                    return
                prev = int(val);
                newConfig['liquid_pump_temp'].append(int(val))

            prev = 0;
            for val in rawConfig['liquid_pump_speed']:
                if prev > int(val):
                    return
                if int(val) > 100:
                    return
                prev = int(val);
                newConfig['liquid_pump_speed'].append(int(val))
        else:
            return

        if 'liquid_fan_temp' in rawConfig and 'liquid_fan_speed' in rawConfig and isinstance(rawConfig['liquid_fan_temp'], list) and isinstance(rawConfig['liquid_fan_speed'], list) and len(rawConfig['liquid_fan_temp'])>0 and len(rawConfig['liquid_fan_temp']) == len(rawConfig['liquid_fan_speed']):
            newConfig['liquid_fan_temp'] = []
            newConfig['liquid_fan_speed'] = []
            prev = 0;
            for val in rawConfig['liquid_fan_temp']:
                if prev > int(val):
                    return
                if int(val) > 150:
                    return
                prev = int(val);
                newConfig['liquid_fan_temp'].append(int(val))

            prev = 0;
            for val in rawConfig['liquid_fan_speed']:
                if prev > int(val):
                    return
                if int(val) > 100:
                    return
                prev = int(val);
                newConfig['liquid_fan_speed'].append(int(val))
        else:
            return

        self.config = newConfig
        self.writeConfig()

class KrakenControllerDBUS(object):
    dbus = """
        <node>
            <interface name='net.mjjw.KrakenController'>
                <method name='Boost'>
                </method>
                <method name=\'GetConfig\'>
                    <arg type="s" name="config" direction="out" />
                </method>
                <method name=\'UpdateConfig\'>
                    <arg type="s" name="config" direction="in" />
                </method>
                <property name="KrakenDevice" type="s" access="read">
                    <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/>
                </property>
                <property name="LiquidTemp" type="i" access="read">
                    <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/>
                </property>
                <property name="CPUTemp" type="i" access="read">
                    <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/>
                </property>
                <property name="FanDuty" type="i" access="read">
                    <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/>
                </property>
                <property name="PumpDuty" type="i" access="read">
                    <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/>
                </property>
            </interface>
        </node>
    """

    def __init__(self, configMgr):
        self._kraken_device = "unknown"
        self._liquid_temp = int(0)
        self._cpu_temp = int(0)
        self._fan_duty = int(0)
        self._pump_duty = int(0)
        self.controller = None
        self.configMgr = configMgr

    @property
    def KrakenDevice(self):
        return self._kraken_device

    @KrakenDevice.setter
    def KrakenDevice(self, value):
        self._kraken_device = value
        self.PropertiesChanged("net.mjjw.KrakenController", {"KrakenDevice": self.KrakenDevice}, [])

    @property
    def LiquidTemp(self):
        return self._liquid_temp

    @LiquidTemp.setter
    def LiquidTemp(self, value):
        if int(value) != self._liquid_temp:
            self._liquid_temp = int(value)
            self.PropertiesChanged("net.mjjw.KrakenController", {"LiquidTemp": self.LiquidTemp}, [])

    @property
    def CPUTemp(self):
        return self._cpu_temp

    @CPUTemp.setter
    def CPUTemp(self, value):
        if int(value) != self._cpu_temp:
            self._cpu_temp = int(value)
            self.PropertiesChanged("net.mjjw.KrakenController", {"CPUTemp": self.CPUTemp}, [])

    @property
    def FanDuty(self):
        return self._fan_duty

    @FanDuty.setter
    def FanDuty(self, value):
        if int(value) != self._fan_duty:
            self._fan_duty = int(value)
            self.PropertiesChanged("net.mjjw.KrakenController", {"FanDuty": self.FanDuty}, [])

    @property
    def PumpDuty(self):
        return self._pump_duty

    @PumpDuty.setter
    def PumpDuty(self, value):
        if int(value) != self._pump_duty:
            self._pump_duty = int(value)
            self.PropertiesChanged("net.mjjw.KrakenController", {"PumpDuty": self.PumpDuty}, [])

    def Boost(self):
        if self.controller is not None:
            self.controller.boost()

    def GetConfig(self):
        return self.configMgr.toJSON();

    def UpdateConfig(self, newConfig):
        self.configMgr.parseJSON(newConfig)
        self.controller.update_speed_(True)

    PropertiesChanged = signal()


class KrakenController:
    """
    Fan and pump control for the Kraken AIO based on CPU temperature
    """

    SOURCES = ['cpu', 'liquid']
    TARGETS = ['fan', 'pump']

    # The time (in seconds) to wait between checking speeds
    CHECK_INTERVAL = 1

    # If the speed is not the desired speed after a given time, update it again
    FORCE_SET_INTERVAL = 10
    FORCE_SET_THRESHOLD = 3

    # Hysteresis - scale up more aggressively than down
    MIN_TEMP_CHANGE_UP = {'cpu': 2, 'liquid': 1}
    MIN_TEMP_CHANGE_DOWN = {'cpu': 5, 'liquid': 2}
    MIN_TIME_CHANGE_UP = 0
    MIN_TIME_CHANGE_DOWN = 10
    MIN_BOOST_DURATION = 10

    MIN_SPEED = {'fan': 25, 'pump': 60}
    MAX_SPEED = {'fan': 100, 'pump': 100}

    def __init__(self, dbus_interface, configMgr):
        # find the Kraken
        supported_devices = KrakenZ3.find_supported_devices()

        if not supported_devices:
            supported_devices = KrakenX3.find_supported_devices()

        if not supported_devices:
            supported_devices = KrakenTwoDriver.find_supported_devices()

        if not supported_devices:
            raise Exception('Failed to find the Kraken X')

        print("Found device: ", supported_devices[0].description)
        self.kraken_device = supported_devices[0]

        self.configMgr = configMgr
        dbus_interface.KrakenDevice = supported_devices[0].description

        # The last update to the speeds
        self.last_update = 0
        self.last_temp = {'cpu': 0, 'liquid': 0}
        self.last_speed_set = {'fan': 0, 'pump': 0}
        self.dbus_interface = dbus_interface
        self.boost_start = 0
        self.dbus_interface.controller = self
        self.was_boosting = False

    # Run fan and pump at maximum for a few minutes
    def boost(self):
        self.boost_start = monotonic()
        self.update_speed_(True)

    # Returns a dictionary containing the status details of the Kraken.
    #
    # Possible keys: fan, liquid, firmware, pump (and now cpu too, for convenience)
    def status(self):
        status = {}

        rawStatus = self.kraken_device.get_status()
        for tup in rawStatus:
            status[tup[0].lower().split(' ')[0]] = tup[1]

        status['cpu'] = self.cpu_temperature()

        # if status['liquid'] < 5:
        #     print(rawStatus)

        return status

    def cpu_temperature(self):
        # lifted from a list I found online somewhere, I forget where but
        # give full credit that I did not compile this myself
        temperatureFiles = [
            '/sys/class/hwmon/hwmon0/temp1_input',
            '/sys/devices/platform/coretemp.0/temp1_input',
            '/sys/bus/acpi/devices/LNXTHERM:00/thermal_zone/temp',
            '/sys/devices/virtual/thermal/thermal_zone0/temp',
            '/sys/bus/acpi/drivers/ATK0110/ATK0110:00/hwmon/hwmon0/temp1_input',
            '/proc/acpi/thermal_zone/THM0/temperature',
            '/proc/acpi/thermal_zone/THRM/temperature',
            '/proc/acpi/thermal_zone/THR0/temperature',
            '/proc/acpi/thermal_zone/TZ0/temperature',
            '/sys/class/hwmon/hwmon0/device/temp1_input'
        ]
        for tfile in temperatureFiles:
            if path.exists(tfile):
                content = open(tfile, "r").readline()
                return float(content.split(' ')[0]) / 1000

        raise Exception("Unable to find CPU temperature")

    def update_speed(self):
        self.update_speed_(False)

    def update_speed_(self, autoforce):
        with self.kraken_device.connect():
            status = self.status()

            self.dbus_interface.CPUTemp = int(status['cpu'])
            if not (status['liquid'] < 5 and status['fan'] == 0 and status['pump'] == 0):
                self.dbus_interface.LiquidTemp = int(status['liquid'])
                self.dbus_interface.FanDuty = int(status['fan'])
                self.dbus_interface.PumpDuty = int(status['pump'])

            forced = autoforce
            current_speed = {}
            new_speed = {}
            force_update = {}

            for target in self.TARGETS:
                current_speed[target] = int(status[target])
                new_speed[target] = 0
                force_update[target] = False

            boost_duration = max(self.configMgr.config['boost_duration'], self.CHECK_INTERVAL*1.5, self.MIN_BOOST_DURATION)
            boosting = monotonic() < (self.boost_start + boost_duration)
            if boosting:
                if not self.was_boosting:
                    # print("pulley boost started for approx " + str(boost_duration) + "s")
                    self.was_boosting = True
                    self.boost_start = monotonic()

                for target in self.TARGETS:
                    new_speed[target] = self.MAX_SPEED[target]
                    if self.last_speed_set[target] != new_speed[target]:
                        force_update[target] = True
                        forced = True
            elif self.was_boosting:
                # print("pulley boost ended")
                self.was_boosting = False
                for target in self.TARGETS:
                    force_update[target] = True
                    forced = True

            # determiune the maximum speed defined for each source,
            # e.g. if liquid resolves fan speed 25 and cpu resolves fan speed 30 then fan speed will be 30
            # because I'm lazy and I wrote bad code we still enter this loop even in fixed mode to detect critical temp
            reached_critical_temp = False
            for target in self.TARGETS:
                for source in self.SOURCES:
                    temp = status[source]
                    if temp <= 5:
                        # there seems to be a bug in liquidctl (or in our use of it?) where sometimes temperature is 0, 1 or 2 C and
                        # all other values are 0
                        continue
                    if temp >= int(self.configMgr.config[source + "_critical"]):
                        new_speed[target] = self.MAX_SPEED[target]
                        reached_critical_temp = True
                    else:
                        # this check is here so that the critical liquid temp gets done even if we are not using the liquid temperature
                        # to control speeds
                        if source == 'liquid' and not self.configMgr.config['use_liquid_temp']:
                            continue
                        elif self.configMgr.config['mode'] == 'fixed':
                            new_speed[target] = max(new_speed[target], self.configMgr.config['fixed_' + target + '_speed'])
                        else:
                            curveXAxis = self.configMgr.config[source + "_" + target + "_temp"];
                            curveYAxis = self.configMgr.config[source + "_" + target + "_speed"];
                            # if we get a borked curve default to 100, if we are off the end then clamp to the last values on the curve,
                            # otherwise interpolate through the curve
                            speed = int(100) if (len(curveXAxis)<=0 or len(curveXAxis) != len(curveYAxis)) else (int(curveYAxis[len(curveYAxis)-1]) if (temp >= curveXAxis[len(curveXAxis)-1]) else int(curveYAxis[0]) if (temp < curveXAxis[0]) else int(interp(temp, curveXAxis, curveYAxis)))
                            new_speed[target] = max(new_speed[target], speed)
                    new_speed[target] = int(min(self.MAX_SPEED[target], max(self.MIN_SPEED[target], new_speed[target])))

            if reached_critical_temp and self.configMgr.config['boost_after_critical']:
                if not self.was_boosting:
                    # print("critical temp reached, pulley will boost to maximum duty")
                    # print("pulley boost started until temperature is reduced")
                    self.was_boosting = True
                self.boost_start = monotonic()

            # print("New speeds: ", new_speed)
            time_now = monotonic()
            time_since_update = time_now - self.last_update

            temp_diff_exceeds_required = reached_critical_temp
            time_diff_exceeds_required = reached_critical_temp

            # after a period of time ensure that the set speed was actually set
            if time_since_update > self.FORCE_SET_INTERVAL:
                for target in self.TARGETS:
                    if abs(current_speed[target] - self.last_speed_set[target]) > self.FORCE_SET_THRESHOLD:
                        forced = True
                        force_update[target] = True

            for source in self.SOURCES:
                temp_diff_since_update = abs(status[source] - self.last_temp[source]);
                for target in self.TARGETS:
                    if new_speed[target] > self.last_speed_set[target] and temp_diff_since_update >= self.MIN_TEMP_CHANGE_UP[source]:
                        temp_diff_exceeds_required = True
                    elif new_speed[target] < self.last_speed_set[target] and temp_diff_since_update >= self.MIN_TEMP_CHANGE_DOWN[source]:
                        temp_diff_exceeds_required = True

            for target in self.TARGETS:
                if new_speed[target] > self.last_speed_set[target] and time_since_update > self.MIN_TIME_CHANGE_UP:
                    time_diff_exceeds_required = True
                elif new_speed[target] < self.last_speed_set[target] and time_since_update > self.MIN_TIME_CHANGE_DOWN:
                    time_diff_exceeds_required = True

            if forced or (temp_diff_exceeds_required and time_diff_exceeds_required):
                self.last_update = time_now
                for source in self.SOURCES:
                    self.last_temp[source] = status[source]

                for target in self.TARGETS:
                    if new_speed[target] <= 0:
                        continue
                    if new_speed[target] != self.last_speed_set[target] or force_update[target]:
                        # if force_update[target]:
                        #     print("Setting ", target, " ", current_speed[target], " => ", new_speed[target], " (forced)")
                        # else:
                        #     print("Setting ", target, " ", self.last_speed_set[target], " => ", new_speed[target])
                        self.last_speed_set[target] = new_speed[target]
                        self.kraken_device.set_fixed_speed(target, new_speed[target])

    def on_timer(self):
        try:
            self.update_speed()
        except Exception as error:
            raise SystemError(error)

        return True


if __name__ == '__main__':
    elevate()
    configMgr = KrakenControllerConfig();
    configMgr.readConfig()
    configMgr.writeConfig()

    dbus_iface = KrakenControllerDBUS(configMgr);
    controller = KrakenController(dbus_iface, configMgr)

    if configMgr.config['enable_dbus']:
        bus = SystemBus()
        bus.publish("net.mjjw.KrakenController", dbus_iface)

    GLib.timeout_add(controller.CHECK_INTERVAL*1000, lambda: controller.on_timer())
    loop = GLib.MainLoop()
    loop.run()
