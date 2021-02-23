from liquidctl.driver.kraken2 import KrakenTwoDriver
from liquidctl.driver.kraken3 import KrakenZ3, KrakenX3
from time import sleep, monotonic
from elevate import elevate
from os import path
from numpy import interp
from pydbus import SystemBus
from gi.repository import GLib

from pydbus.generic import signal

class KrakenControllerDBUS(object):
    dbus = """
        <node>
            <interface name='net.mjjw.KrakenController'>
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

    def __init__(self):
        self._kraken_device = "unknown"
        self._liquid_temp = int(0)
        self._cpu_temp = int(0)
        self._fan_duty = int(0)
        self._pump_duty = int(0)

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

    PropertiesChanged = signal()


class KrakenController:
    """
    Fan and pump control for the Kraken AIO based on CPU temperature
    """

    SOURCES = ['cpu', 'liquid']
    TARGETS = ['fan', 'pump']

    # The time (in seconds) to wait between checking speeds
    CHECK_INTERVAL = 2

    # If the speed is not the desired speed after a given time, update it again
    FORCE_SET_INTERVAL = 10
    FORCE_SET_THRESHOLD = 3

    # Hysteresis - scale up more aggressively than down
    MIN_TEMP_CHANGE_UP = {
        'cpu': 2,
        'liquid': 1
    }
    MIN_TEMP_CHANGE_DOWN = {
        'cpu': 5,
        'liquid': 2
    }
    MIN_TIME_CHANGE_UP = 0
    MIN_TIME_CHANGE_DOWN = 10

    CRIT_TEMP = {
        'cpu': 80,
        'liquid': 40
    }

    MIN_SPEED = {
        'fan': 25,
        'pump': 60
    }

    MAX_SPEED = {
        'fan': 100,
        'pump': 100
    }

    CURVES = {
        'fan': {
            'cpu': {
                'temp': [0, 30, 40, 50, 60, 70, 75],
                'speed': [25, 25, 25, 25, 50, 75, 100]
            },
            'liquid': {
                'temp': [0, 35, 40],
                'speed': [25, 25, 100]
            },
        },
        'pump': {
            'cpu': {
                'temp': [0, 30, 40, 50, 60, 70, 75],
                'speed': [60, 60, 60, 60, 80, 90, 100]
            },
            'liquid': {
                'temp': [0, 35, 40],
                'speed': [60, 60, 100]
            }
        },
    }

    def __init__(self, dbus_interface):
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
        dbus_interface.KrakenDevice = supported_devices[0].description

        # The last update to the speeds
        self.last_update = 0
        self.last_temp = {'cpu': 0, 'liquid': 0}
        self.last_speed_set = {'fan': 0, 'pump': 0}
        self.dbus_interface = dbus_interface

    # Returns a dictionary containing the status details of the Kraken.
    #
    # Possible keys: fan, liquid, firmware, pump
    def status(self):
        status = {}

        for tup in self.kraken_device.get_status():
            status[tup[0].lower().split(' ')[0]] = tup[1]

        status['cpu'] = self.cpu_temperature()

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
        with self.kraken_device.connect():
            status = self.status()
            self.dbus_interface.CPUTemp = status['cpu']

            if not(status['pump'] == 0 or status['fan'] == 0):
                self.dbus_interface.LiquidTemp = status['liquid']
                self.dbus_interface.FanDuty = status['fan']
                self.dbus_interface.PumpDuty = status['pump']

            current_speed = {
                'fan': int(status['fan']),
                'pump': int(status['pump'])
            }
            new_speed = {
                'fan': 0,
                'pump': 0
            }

            # determiune the maximum speed defined for each source,
            # e.g. if liquid resolves fan speed 25 and cpu resolves fan speed 30 then fan speed will be 30
            reached_critical_temp = False
            for target in self.TARGETS:
                for source in self.SOURCES:
                    temp = status[source]
                    if temp <= 0:
                        continue
                    if temp >= self.CRIT_TEMP[source]:
                        new_speed[target] = self.MAX_SPEED[target]
                        reached_critical_temp = True
                    else:
                        curve = self.CURVES[target][source]
                        speed = int(interp(temp, curve['temp'], curve['speed']))
                        new_speed[target] = max(new_speed[target], speed)
                    new_speed[target] = int(min(self.MAX_SPEED[target], max(self.MIN_SPEED[target], new_speed[target])))

            # print("New speeds: ", new_speed)
            time_now = monotonic()
            time_since_update = time_now - self.last_update

            temp_diff_exceeds_required = reached_critical_temp
            time_diff_exceeds_required = reached_critical_temp
            forced = False
            force_update = {'fan': False, 'pump': False}

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
                for source in self.SOURCES:
                    print(source, " ", status[source])

                self.last_update = time_now
                for source in self.SOURCES:
                    self.last_temp[source] = status[source]

                for target in self.TARGETS:
                    if new_speed[target] <= 0:
                        continue
                    if new_speed[target] != self.last_speed_set[target] or force_update[target]:
                        if force_update[target]:
                            print("Setting ", target, " ", current_speed[target], " => ", new_speed[target], " (forced)")
                        else:
                            print("Setting ", target, " ", self.last_speed_set[target], " => ", new_speed[target])

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
    dbus_iface = KrakenControllerDBUS();
    bus = SystemBus()
    bus.publish("net.mjjw.KrakenController", dbus_iface)
    controller = KrakenController(dbus_iface)
    GLib.timeout_add(controller.CHECK_INTERVAL*1000, lambda: controller.on_timer())
    loop = GLib.MainLoop()
    loop.run()
