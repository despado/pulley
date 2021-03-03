# README

pulley is a small Python script that uses
[liquidctl](https://github.com/jonasmalacofilho/liquidctl/) to control the fan
and pump speeds of an NZXT Kraken X or Z, such as the Z73.

pulley is based very heavily on
[krakenpie](https://gitlab.com/yorickpeterse/krakenpie) however it only works
on Linux and it uses the CPU temperature instead of the GPU temperature. It
is not extensively tested and I am not responsible if your CPU self-immolates.

Like krakenpie, this software caters to my own needs, it would be great if
someone wanted to take this on, otherwise development will only happen when I
need it to.

## Why

The Kraken AIO is an awesome piece of kit with one incredible shortcoming. The
motherboard is unable to control the Kraken pump directly and the only sensor
the Kraken has access to is liquid temperature. CPU temperature is a preferable
way to control pump as this is the thing you are really trying to control with
the liquid cooling.

[krakenpie](https://gitlab.com/yorickpeterse/krakenpie) is Windows only and
uses GPU temperature not CPU temperature.

## Why the name pulley?

The name CAM was taken.

## Features

![GitHub Logo](/images/pulley.png)

* Controls the pump and fan speed based on liquid and CPU temperature
* Applies hysteresis to prevent overly frequent updates
* Works on Linux only (easily portable if you know how to get CPU temperature)
* No warranty whatsoever, don't blame me if your PC catches fire
* GUI editor for fan curves
* Cinnamon Applet
* Controlled by config file

## Requirements

* Python 3.7 (older versions of Python 3 might also work)
* Pip
* liquidctl
* libusb (for liquidctl)
* A single Kraken X or Z (pulley simply picks the first one available)
* Linux

## Installation

The install script is tested on Linux Mint 20, but it should work on any modern
Linux distro. If you are using cinnamon then the applet should get installed too.

    git clone https://github.com/despado/pulley
    cd pulley
    sudo bash install.sh

If you use cinnamon don't forget to right click on the tast bar, select applets,
find Kraken Control, select it, click + at bottom of window.

## Configuration

Edit /etc/pulley.conf, the fan curves map temperature to speed.

### Seems kind of complicated?

If you can't follow the instructions then you probably shouldn't be using
experimental drivers for your CPU cooler.

If you can follow the instructions and have the time to invest 
to make a proper package or whatever then feel free. 

## Where can I get support?

You can't, none is provided. Sorry about that.

## TODO

* Package this up with proper installation rather than bodged together shell script
* CPU temperature display on Z series
* Set the ring color based on temperature on X series
* Display temperatures on the Z series

## License

As this is based on [krakenpie](https://gitlab.com/yorickpeterse/krakenpie) all
source code in this repository is licensed under the Mozilla Public License
version 2.0, unless stated otherwise. A copy of this license can be found in the
file "LICENSE".
