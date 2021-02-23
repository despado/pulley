from pydbus import SystemBus
from gi.repository import GLib

def _on_property_changed(sender, obj, arr):
    for key in obj:
        print(key, " => ", obj[key])

if __name__ == '__main__':
    bus = SystemBus()
    controller = bus.get("net.mjjw.KrakenController")
    print("--- Initial ---")
    print("Device:      ", controller.KrakenDevice)
    print("Fan Duty:    ", controller.FanDuty)
    print("Pump Duty:   ", controller.PumpDuty)
    print("CPU Temp:    ", controller.CPUTemp)
    print("Liquid Temp: ", controller.LiquidTemp)
    print("--- Updates ---")
    controller.PropertiesChanged.connect(_on_property_changed)
    loop = GLib.MainLoop()
    loop.run()