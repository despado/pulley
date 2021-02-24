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

* Controls the pump and fan speed based on liquid and CPU temperature
* Applies hysteresis to prevent overly frequent updates
* Works on Linux only (easily portable if you know how to get CPU temperature)
* No warranty whatsoever, don't blame me if your PC catches fire
* Cinnamon Applet
* Controlled by config file

## Requirements

* Python 3.7 (older versions of Python 3 might also work)
* Pip
* libusb (for liquidctl)
* A single Kraken X or Z (pulley simply picks the first one available)
* Linux

## Installation

On my distribution something like this will probably work. Yours may differ:

    # download code
    cd pulley
    sudo apt install python3 python3-pip libusb-1.0-0
    pip3 install -r ./requirements.txt
    # edit this file to adjust your fan curves
    sudo cp pulley.conf /etc/pulley.conf
    # to auto run pulley
    # edit the file pulley.service to point to the right place
    nano pulley.service # .....
    sudo cp pulley.service /lib/systemd/system/pulley.service
    sudo systemctl daemon-reload
    sudo systemctl enable pulley.service
    sudo systemctl start pulley.service
    # if you use cinnamon 
    cp pulley@mjjw ~/.local/share/cinnamon/applets/pulley@mjjw
    # now right click on taskbar, select applets, find Kraken Control, select it, click + at bottom of window

### Seems kind of complicated?

If you can't follow the instructions then you probably shouldn't be using
experimental drivers for your CPU cooler.

If you can follow the instructions and have the time to invest 
to make a proper package or whatever then feel free. 

## Where can I get support?

You can't, none is provided. Sorry about that.

## TODO

* Integrate with [gkraken](https://gitlab.com/leinardi/gkraken) or similar for
  a nice UI to set fan curves
* Package this up so that it is easy to install
* CPU temperature display on Z series
* Set the ring color based on temperature on X series

## License

As this is based on [krakenpie](https://gitlab.com/yorickpeterse/krakenpie) all
source code in this repository is licensed under the Mozilla Public License
version 2.0, unless stated otherwise. A copy of this license can be found in the
file "LICENSE".
