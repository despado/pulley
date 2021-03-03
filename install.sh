#! /bin/bash
if [[ "$EUID" -ne 0 ]]; then
	echo "This script requires root priviledge, try again using sudo"
	exit
fi
echo "Installing pulley"
if [ ! -f /etc/pulley.conf ]; then
	echo "Copying pulley.conf => /etc/pulley.conf"
	cp pulley.conf /etc/pulley.conf
fi
if [ ! -d /opt/pulley ]; then
	echo "Creating /opt/pulley"
	mkdir -p /opt/pulley
fi
echo "Installing requirements"
pip3 install -r ./requirements.txt

echo "Copying files"
cp LICENSE /opt/pulley/LICENSE
cp pulley.py /opt/pulley/pulley.py
cp pulley.js /opt/pulley/pulley.js
cp pulley@mjjw/icon.png /opt/pulley/pulley.png

if [ -d $HOME/.local/share/cinnamon ]; then
	echo "Installing cinnamon applet"
	cp -r mjjw@pulley $HOME/.local/share/cinnamon/mjjw@pulley
    chown -R $USER.$USER $HOME/.local/share/cinnamon/mjjw@pulley
fi

if [ -d $HOME/.local/share/applications ]; then
	echo "Installing desktop icon"
	cp pulley.desktop $HOME/.local/share/applications/pulley.desktop
    chown $USER.$USER $HOME/.local/share/applications/pulley.desktop
fi

if [ -f /opt/pulley/pulley.py ]; then
	if [ ! -f /lib/systemd/system/pulley.service ]; then
		if [  -d /lib/systemd/system ]; then
			cp pulley.service /lib/systemd/system/pulley.service
			systemctl daemon-reload
			systemctl enable pulley.service
			systemctl start pulley.service
		else
			echo "ERROR: systemd not found, unable to autostart"
			exit
		fi
	else
		echo "pulley service already installed, restarting"
		systemctl daemon-reload
		systemctl restart pulley.service
	fi
else
	echo "There was an error installing pulley"
fi

echo "Done!"

