// Originally used temperature@fevimu as a template
const St = imports.gi.St;
const PopupMenu = imports.ui.popupMenu;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio; // Needed for file infos
const Util = imports.misc.util;
const Lang = imports.lang;
const Mainloop = imports.mainloop;
const Applet = imports.ui.applet;
const Settings = imports.ui.settings;
const Gettext = imports.gettext;
const Interfaces = imports.misc.interfaces;
const UUID = "pulley@mjjw";

const _ = function(str) {
  let translation = Gettext.gettext(str);
  if (translation !== str) {
    return translation;
  }
  return Gettext.dgettext(UUID, str);
}

const KrakenControllerProxy = Gio.DBusProxy.makeProxyWrapper('\
<node> \
    <interface name="net.mjjw.KrakenController"> \
        <method name=\'Boost\'> \
        </method> \
        <property name="KrakenDevice" type="s" access="read"> \
            <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/> \
        </property> \
        <property name="LiquidTemp" type="i" access="read"> \
            <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/> \
        </property> \
        <property name="CPUTemp" type="i" access="read"> \
            <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/> \
        </property> \
        <property name="FanDuty" type="i" access="read"> \
            <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/> \
        </property> \
        <property name="PumpDuty" type="i" access="read"> \
            <annotation name="org.freedesktop.DBus.Property.EmitsChangedSignal" value="true"/> \
        </property> \
    </interface> \
</node>');

function KrakenControlApplet(metadata, orientation, instance_id) {
  this._init(metadata, orientation, instance_id);
}

KrakenControlApplet.prototype = {
    __proto__: Applet.TextApplet.prototype,

    _init: function(metadata, orientation, instance_id) {
        Applet.TextApplet.prototype._init.call(this, orientation, instance_id);

        this.orientation = orientation;
        this.setAllowedLayout(Applet.AllowedLayout.BOTH);
        this.on_orientation_changed(orientation); // Initializes for panel orientation
        this.menuItems = [];
        this.state = {};
        this.settings = new Settings.AppletSettings(this.state, metadata.uuid, instance_id);

        this.settings.bindProperty(Settings.BindingDirection.IN, 'use-fahrenheit', 'useFahrenheit', () => this.on_settings_changed(), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-temps', 'showTemps', () => this.on_settings_changed(), null);
        this.settings.bindProperty(Settings.BindingDirection.IN, 'show-boost', 'showBoost', () => this.on_settings_changed(), null);

        this.statusLabel = new St.Label({
            text: '--',
            style_class: 'temperature-label'
        });

        // Create the popup menu
        this.menuManager = new PopupMenu.PopupMenuManager(this);
        this.menu = new Applet.AppletPopupMenu(this, orientation);
        this.menuManager.addMenu(this.menu);
        
        this.set_applet_label(_('Kraken Control'));
        this.set_applet_tooltip(_('Kraken Control'));

        this.kraken_info = { KrakenDevice: "not found", LiquidTemp: -1, CPUTemp: -1, PumpDuty: -1, FanDuty: -1 };
        this.onUpdate();

        this.kcProxy = null;
        this.kcProxyPropertiesID = null;
        this.busWatchId = null;
        this.connectDBus();
    },
    update_kraken_info: function(proxy) {
        var updates = false;
        [ "KrakenDevice", "LiquidTemp", "CPUTemp", "PumpDuty", "FanDuty" ].forEach(function(key) {
            if ((proxy[key] !== null) && (this.kraken_info[key] !== proxy[key])) {
                this.kraken_info[key] = proxy[key];
                updates = true;       
            }
        }.bind(this));
        if (updates) {
            this.onUpdate();
        }
    },
    onNameAppeared: function(connection, name, _owner) {
        try {
            this.kcProxy = new KrakenControllerProxy(Gio.DBus.system, 'net.mjjw.KrakenController', '/net/mjjw/KrakenController' );
        } catch (e) {
            return;
        }

        let onProps = this.update_kraken_info.bind(this);
        this.kcProxyPropertiesID = this.kcProxy.connect('g-properties-changed', (proxy, changed, invalidated) => { 
            onProps(proxy);
        });
        this.update_kraken_info(this.kcProxy);
    },
    onNameVanished: function(connection, name) {
        this.disconnectProxy();
    },
    disconnectProxy: function() {
        if (this.kcProxy !== null && this.kcProxyPropertiesID !== null) {
            this.kcProxy.disconnect(this.kcProxyPropertiesID);
        }    
        this.kcProxy = null;
        this.kcProxyPropertiesID = null;
        this.kraken_info = { KrakenDevice: "not found", LiquidTemp: -1, CPUTemp: -1, PumpDuty: -1, FanDuty: -1 };
        this.onUpdate();
    },
    connectDBus: function() {
        if (this.busWatchId !== null) {
            this.disconnectDBus();
        }

        this.busWatchId = Gio.bus_watch_name(Gio.BusType.SYSTEM, 'net.mjjw.KrakenController', Gio.BusNameWatcherFlags.NONE, this.onNameAppeared.bind(this), this.onNameVanished.bind(this));
    },
    disconnectDBus: function() {
        if (this.busWatchId !== null) {
            Gio.bus_unown_name(this.busWatchId);
        }
        this.busWatchId = null;
        this.disconnectProxy();
    },
    on_settings_changed: function() {
        this.onUpdate();
    },
    on_orientation_changed: function (orientation) {
        this.orientation = orientation;
        if (this.orientation == St.Side.LEFT || this.orientation == St.Side.RIGHT) {
            // vertical
            this.isHorizontal = false;
        } else {
            // horizontal
            this.isHorizontal = true;
        }
    }, // End of on_orientation_changed
    on_applet_clicked: function() {
        this.buildMenu(this.menuItems);
        this.menu.toggle();
    },
    on_applet_removed_from_panel: function() {
        // todo: if I log dbus messages I still see them after we were removed - need to figure this out
        this.settings.finalize();
        this.disconnectDBus();
    },
    buildMenu: function(items) {
        this.menu.removeAll();
        let isOpen = this.menu.isOpen;
        let section = new PopupMenu.PopupMenuSection(_('Temperature'));
        if (items.length > 0) {
            for (let i = 0; i < items.length; i++) {
                if (typeof(items[i]) != "string") {
                    let item = new PopupMenu.PopupMenuItem(items[i][0]);
                    item.connect('activate', items[i][1]);
                    section.addMenuItem(item);
                } else {
                    section.addMenuItem(new PopupMenu.PopupMenuItem(items[i]));
                }
            }
        } else {
            let item = new PopupMenu.PopupMenuItem("Kraken Controller");
            item.connect('activate', function() {
                Util.trySpawn(['xdg-open', 'https://github.com/despado/pulley']);
            });
            section.addMenuItem(item);
        }
        this.menu.addMenuItem(section);
        if (isOpen) {
            this.menu.open();
        }
    },
    toFahrenheit: function(c) {
        return 9 / 5 * c + 32;
    },
    formatTemp: function(_celcius) {
        let celcius = Number(_celcius);
        let temperature = this.state.useFahrenheit ? this.toFahrenheit(celcius) : celcius;
        var unit = "";
        if (this.state.useFahrenheit) {
            unit = "°F";
        } else {
            unit = "°C";
        }
        return temperature.toString() + unit;
    },
    onUpdate: function() {
        const kraken_info = this.kraken_info;

        var cpuTemp = kraken_info.CPUTemp > 0 ? this.formatTemp(kraken_info.CPUTemp) : "??";

        let items = [];
        items.push("Device: " + kraken_info.KrakenDevice);
        if (this.state.showTemps) {
            if (kraken_info.LiquidTemp > 0) {
                items.push("Liquid: " + this.formatTemp(kraken_info.LiquidTemp));
            }
            if (kraken_info.CPUTemp > 0) {
                items.push("CPU: " + cpuTemp);
            }
            if (kraken_info.PumpDuty > 0) {
                items.push("Pump: " + kraken_info.PumpDuty + "%");
            }
            if (kraken_info.FanDuty > 0) {
                items.push("Fan: " + kraken_info.FanDuty + "%");
            }
        }
        if (this.state.showBoost) {
            items.push(["Boost", function() { this.kcProxy.BoostSync(); }.bind(this)]);
        }
        if (kraken_info.LiquidTemp <= 0 && kraken_info.CPUTemp <= 0 && kraken_info.PumpDuty <= 0 && kraken_info.FanDuty <= 0)
            items = [ items[0], "Is pulley running?" ];
            
        this.set_applet_label("CPU: " + cpuTemp);
        if (this.menu.isOpen) {
            this.buildMenu(items);
        } else {
            this.menuItems = items;
        }
    }
};

function main(metadata, orientation, instance_id) {
  return new KrakenControlApplet(metadata, orientation, instance_id);
}
