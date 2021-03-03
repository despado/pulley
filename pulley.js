const Cairo         = imports.cairo;
const Gdk           = imports.gi.Gdk;
const GLib          = imports.gi.GLib;
const Gtk           = imports.gi.Gtk;
const Lang          = imports.lang;
const Gio = imports.gi.Gio;

const Application = new Lang.Class({
    Name: 'Application',

    _init: function(dbusAdapter) {
        this.title = "Pulley - Kraken Control";
        this._classType = "close";
        GLib.set_prgname(this.title);
        this.window = null;
        this.application = new Gtk.Application();
        this.application.connect('activate', Lang.bind(this, this._onActivate));
        this.application.connect('startup', Lang.bind(this, this._onStartup));
        this.selectedNode = null;
        this.selectedSegment = null;
        this.mouseDown = false;
        this.dragStart = null;
        this.nodeOrigin = null;
        this.removeOnDragEnd = false;
        this.dbusAdapter = dbusAdapter !== null ? dbusAdapter : null;

        this.settings = {
            mode: "custom",
            cpuCriticalTemp: 80,
            liquidCriticalTemp: 40,
            boostAfterCritical: true,
            boostDuration: 60,
            fixedFanDuty: 75,
            fixedPumpDuty: 75,
            curves: {
                cpu: {
                    pump: {
                        temp: [0, 30, 40, 50, 60, 70, 75],
                        speed: [60, 60, 60, 60, 80, 90, 100]
                    },
                    fan: {
                        temp: [0, 30, 40, 50, 60, 70, 75],
                        speed: [25, 25, 25, 25, 50, 75, 100]
                    }
                },
                liquid: {
                    pump: {
                        temp: [0, 35, 40],
                        speed: [60, 60, 100]
                    },
                    fan: {
                        temp: [0, 35, 40],
                        speed: [25, 25, 100]
                    }
                },
            }
        };
        this.lastSettings = JSON.parse(JSON.stringify(this.settings));
        this.widgets = {
            infoBar: null,
            infoBarMessage: null,
            fanDuty: null,
            pumpDuty: null,
            cpuTemp: null,
            liquidTemp: null,
            mode: null,
            cpuCriticalTemp: null,
            liquidCriticalTemp: null,
            boostAfterCritical: null,
            boostDuration: null,
            fixedFanDuty: null,
            fixedPumpDuty: null,
            cpuGraph: null,
            liquidGraph: null
        };
        this.lastDeviceSeen = null;

        this.dbusAdapter.onProps = (props) => {
            let deviceName = props.KrakenDevice == null ? null : props.KrakenDevice;
            if (this.lastDeviceSeen != deviceName) {
                this.lastDeviceSeen = deviceName;
                if (!this.widgets.infoBar.get_visible()) {
                    this.widgets.infoBar.set_visible(false) 
                }
                if (deviceName !== null) {
                    this.widgets.infoBar.set_message_type(Gtk.MessageType.INFO);
                    this.widgets.infoBarMessage.set_label("Device: " + deviceName);
                } else {
                    this.widgets.infoBar.set_message_type(Gtk.MessageType.ERROR);
                    this.widgets.infoBarMessage.set_label("Device not found, is pulley running?");
                }
            };
            if (this.widgets.fanDuty !== null) {
                if (props.FanDuty == null || props.FanDuty <= 0 || props.FanDuty > 100) {
                    this.widgets.fanDuty.set_label("<span size='xx-large'>--</span>");
                } else {
                    this.widgets.fanDuty.set_label("<span size='xx-large'>" + String(Math.round(props.FanDuty)) + "%</span>");
                }
            }
            if (this.widgets.pumpDuty !== null) {
                if (props.PumpDuty == null || props.PumpDuty <= 0 || props.PumpDuty > 100) {
                    this.widgets.pumpDuty.set_label("<span size='xx-large'>--</span>");
                } else {
                    this.widgets.pumpDuty.set_label("<span size='xx-large'>" + String(Math.round(props.PumpDuty)) + "%</span>");
                }
            }
            if (this.widgets.cpuTemp !== null) {
                if (props.CPUTemp == null || props.CPUTemp <= 0 || props.CPUTemp > 150) {
                    this.widgets.cpuTemp.set_label("<span size='xx-large'>--</span>");
                } else {
                    this.widgets.cpuTemp.set_label("<span size='xx-large'>" + String(Math.round(props.CPUTemp)) + "°C</span>");
                }
            }
            if (this.widgets.liquidTemp !== null) {
                if (props.LiquidTemp == null || props.LiquidTemp <= 0 || props.LiquidTemp > 150) {
                    this.widgets.liquidTemp.set_label("<span size='xx-large'>--</span>");
                } else {
                    this.widgets.liquidTemp.set_label("<span size='xx-large'>" + String(Math.round(props.LiquidTemp)) + "°C</span>");
                }
            }
        };
    },

    revertSettings: function() {
        this.settings = JSON.parse(JSON.stringify(this.lastSettings));
        this.widgets.cpuGraph.queue_draw();
        this.widgets.liquidGraph.queue_draw();
        switch (this.settings.mode) {
            case "fixed": 
                this.widgets.mode.set_active(0); 
                break;
            case "custom": 
                this.widgets.mode.set_active(1); 
                break;
            case "custom+liquid": 
                this.widgets.mode.set_active(2); 
                break;
        }        
        this.widgets.cpuCriticalTemp.set_value(this.settings.cpuCriticalTemp);
        this.widgets.liquidCriticalTemp.set_value(this.settings.liquidCriticalTemp);
        this.widgets.boostAfterCritical.set_state(this.settings.boostAfterCritical);
        this.widgets.boostDuration.set_value(this.settings.boostDuration);
        this.widgets.fixedFanDuty.set_value(this.settings.fixedFanDuty);
        this.widgets.fixedPumpDuty.set_value(this.settings.fixedPumpDuty);
    },

    applySettings: function() {
        switch(this.widgets.mode.get_active()) {
            case 0: 
                this.settings.mode = "fixed"; 
                break;
            case 1: 
                this.settings.mode = "custom"; 
                break;
            case 2: 
                this.settings.mode = "custom+liquid"; 
                break;
        }
        this.settings.cpuCriticalTemp = this.widgets.cpuCriticalTemp.get_value();
        this.settings.liquidCriticalTemp = this.widgets.liquidCriticalTemp.get_value();
        this.settings.boostAfterCritical = this.widgets.boostAfterCritical.get_state();
        this.settings.boostDuration = this.widgets.boostDuration.get_value();
        this.settings.fixedFanDuty = this.widgets.fixedFanDuty.get_value();
        this.settings.fixedPumpDuty = this.widgets.fixedPumpDuty.get_value();
        this.lastSettings = JSON.parse(JSON.stringify(this.settings));
        this.writeSettings();
        this.readSettings();
    },

    writeSettings: function() {
        this.dbusAdapter.setConfig(this.settings);
    },

    readSettings: function() {
        let settings = this.dbusAdapter.getConfig();
        if (settings != null && settings.mode != "") {
            this.settings = JSON.parse(JSON.stringify(settings));
            this.lastSettings = JSON.parse(JSON.stringify(settings));
            this.revertSettings();
        }
    },

    run: function (ARGV) {
        this.application.run([]);
    },

    _onActivate: function (ARGV) {
        if (this.window) {
            this.window.show_all();
        }
    },

    _onStartup: function (ARGV) {
        this.buildUI();
    },

    makeLabel: function(text) {
        return new Gtk.Label({label: text, margin_left: 8, margin_right: 8, halign: Gtk.Align.START});
    },

    attachToGrid: function(grid, gridRow, label, controlWidget) {
        let gridColumnLabel = 0;
        let gridColumnControl = 1;
        let labelWidget = typeof(label)=="string" ? this.makeLabel(label) : label;
        grid.attach(labelWidget, gridColumnLabel, gridRow, 1, 1);
        grid.attach(controlWidget, gridColumnControl, gridRow, 1, 1);
    },

    buildUI: function () {
        this.window = new Gtk.Window({
            application: this.application,
            title: this.title,
            default_height: 500,
            default_width: 500,
            window_position: Gtk.WindowPosition.CENTER
        });
        this.window.set_icon_name('application-x-executable');

        let headerBar = new Gtk.HeaderBar({show_close_button: true});
        this.window.set_titlebar(headerBar);
        this.window.set_title("Pulley");        

        let outerBox = new Gtk.VBox({spacing: 8});

        let infoBar = new Gtk.InfoBar({
            show_close_button: true,
        });
        infoBar.connect( 'close', () => infoBar.set_visible(false) );
        infoBar.connect( 'response', () => infoBar.set_visible(false) );
        let infoBarMessage = new Gtk.Label({label: "Waiting for device ..."});
        this.widgets.infoBar = infoBar;
        this.widgets.infoBarMessage = infoBarMessage;
        infoBar.get_content_area().add(infoBarMessage);

        outerBox.add(infoBar);

        let box = new Gtk.VBox({spacing: 8, margin_left: 8, margin_right: 8});

        let hbox = new Gtk.HBox({margin_top: 8});

        let vboxFan = new Gtk.VBox({});
        vboxFan.add(new Gtk.Label({label: "Fan Duty"}));
        this.widgets.fanDuty = new Gtk.Label({use_markup: true, label: "<span size='xx-large'>--</span>"});
        vboxFan.add(this.widgets.fanDuty);
        hbox.add(vboxFan);

        let vboxPump = new Gtk.VBox({});
        vboxPump.add(new Gtk.Label({label: "Pump Duty"}));
        this.widgets.pumpDuty = new Gtk.Label({use_markup: true, label: "<span size='xx-large'>--</span>"});
        vboxPump.add(this.widgets.pumpDuty);
        hbox.add(vboxPump);

        let vboxCPU = new Gtk.VBox({});
        vboxCPU.add(new Gtk.Label({label: "CPU"}));
        this.widgets.cpuTemp = new Gtk.Label({use_markup: true, label: "<span size='xx-large'>--</span>"});

        vboxCPU.add(this.widgets.cpuTemp);
        hbox.add(vboxCPU);

        let vboxLiquid = new Gtk.VBox({});
        vboxLiquid.add(new Gtk.Label({label: "Liquid"}));
        this.widgets.liquidTemp = new Gtk.Label({use_markup: true, label: "<span size='xx-large'>--</span>"});
        vboxLiquid.add(this.widgets.liquidTemp);
        hbox.add(vboxLiquid);

        box.add(hbox);

        let grid = new Gtk.Grid({ column_spacing: 16, row_spacing: 16});
        var gridRow = 0;

        let modeSelect = new Gtk.ComboBoxText({});
        modeSelect.append_text("Fixed Speed");
        modeSelect.append_text("Custom (CPU Only)");
        modeSelect.append_text("Custom (CPU+Liquid)");
        modeSelect.set_active(1);
        this.widgets.mode = modeSelect;
        this.attachToGrid(grid, gridRow++, "Mode", modeSelect);

        let stack = new Gtk.Stack({});
        stack.transition_type = Gtk.StackTransitionType.SLIDE_LEFT_RIGHT;
        stack.transition_duration = 250;
        let stackPanels = [ 
            new Gtk.Grid({ column_spacing: 16, row_spacing: 16}), 
            new Gtk.Grid({ column_spacing: 16, row_spacing: 16}), 
            new Gtk.Grid({ column_spacing: 16, row_spacing: 16}), 
            new Gtk.Grid({ column_spacing: 16, row_spacing: 16}), 
            new Gtk.Grid({ column_spacing: 16, row_spacing: 16}) ];
        var panelIdx = 0;

        let cpuCritical = new Gtk.SpinButton({});
        cpuCritical.set_range(0, 100);
        cpuCritical.set_increments(1, 5);
        cpuCritical.set_snap_to_ticks(true);
        cpuCritical.set_value(80);
        this.widgets.cpuCriticalTemp = cpuCritical;
        this.attachToGrid(stackPanels[panelIdx], 0, "CPU Critical Temp", cpuCritical);

        let liquidCritical = new Gtk.SpinButton({});
        liquidCritical.set_range(0, 100);
        liquidCritical.set_increments(1, 5);
        liquidCritical.set_snap_to_ticks(true);
        liquidCritical.set_value(40);
        this.widgets.liquidCriticalTemp = liquidCritical;
        this.attachToGrid(stackPanels[panelIdx], 1, "Liquid Critical Temp", liquidCritical);

        let boostAfterCritical = new Gtk.Switch({});
        boostAfterCritical.set_state(true);
        this.widgets.boostAfterCritical = boostAfterCritical;
        this.attachToGrid(stackPanels[panelIdx], 2, "Boost after critical", boostAfterCritical);

        let boostRange = new Gtk.Scale({});
        boostRange.set_range(0, 300);
        boostRange.set_digits(0);
        boostRange.set_draw_value(true);
        boostRange.set_value_pos(Gtk.PositionType.LEFT);
        boostRange.get_adjustment().set_value(60);
        this.widgets.boostDuration = boostRange;
        this.attachToGrid(stackPanels[panelIdx], 3, "Boost Duration", boostRange);

        let boostButton = new Gtk.Button({label: "Boost Now"})
        boostButton.connect('clicked', () => {
            this.dbusAdapter.boost();
        });
        stackPanels[panelIdx].attach(boostButton, 2, 2, 1, 2);
        ++panelIdx;

        let fixedFanSpeed = new Gtk.SpinButton({});
        fixedFanSpeed.set_range(25, 100);
        fixedFanSpeed.set_increments(1, 5);
        fixedFanSpeed.set_snap_to_ticks(true);
        fixedFanSpeed.set_value(75);
        this.widgets.fixedFanDuty = fixedFanSpeed;
        this.attachToGrid(stackPanels[panelIdx], 0, "Fixed Fan Duty", fixedFanSpeed);

        let fixedPumpSpeed = new Gtk.SpinButton({});
        fixedPumpSpeed.set_range(25, 100);
        fixedPumpSpeed.set_increments(1, 5);
        fixedPumpSpeed.set_snap_to_ticks(true);
        fixedPumpSpeed.set_value(75);
        this.widgets.fixedPumpDuty = fixedPumpSpeed;
        this.attachToGrid(stackPanels[panelIdx], 1, "Fixed Pump Duty", fixedPumpSpeed);
        ++panelIdx;

        box.add(grid);

        let cpuGraphHBox = new Gtk.HBox({});
        let cpuGraph = new Gtk.DrawingArea({halign: Gtk.Align.CENTER, can_focus: true});
        cpuGraph.set_size_request(450, 360);
        cpuGraph.connect('draw', (area, ctx) => { this.draw(area, ctx, "cpu"); });
        cpuGraphHBox.add(cpuGraph);
        cpuGraph.connect('button_press_event', (area, dc) => { 
            if (this.settings.mode == "fixed") {
                return;
            }
            let mousePos = area.get_pointer();
            this.dragStart = { x: mousePos[0], y: mousePos[1] };
            this.mouseDown = true;
            if (this.processMouse(mousePos, "cpu")) {
                area.queue_draw();
            }
        });
        cpuGraph.connect('button_release_event', (area, dc, dc2) => {
            if (this.settings.mode == "fixed") {
                return;
            }
            this.mouseDown = false;
            if (this.processMouse(area.get_pointer(), "cpu")) {
                area.queue_draw();
            }
            this.dragStart = null;
        });
        cpuGraph.connect('motion_notify_event', (area, dc) => {
            if (this.settings.mode == "fixed") {
                return;
            }
            if (this.processMouse(area.get_pointer(), "cpu")) {
                area.queue_draw();
            }
        });
        cpuGraph.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK | Gdk.EventMask.BUTTON_MOTION_MASK | Gdk.EventMask.POINTER_MOTION_MASK);
        this.widgets.cpuGraph = cpuGraph;
        stackPanels[panelIdx].attach(cpuGraphHBox, 0, 0, 1, 1);
        ++panelIdx;

        let liquidGraphHBox = new Gtk.HBox({});
        let liquidGraph = new Gtk.DrawingArea({halign: Gtk.Align.CENTER, can_focus: true});
        liquidGraph.set_size_request(450, 360);
        liquidGraph.connect('draw', (area, ctx) => { this.draw(area, ctx, "liquid"); });
        liquidGraphHBox.add(liquidGraph);
        liquidGraph.connect('button_press_event', (area, dc) => { 
            if (this.settings.mode != "custom+liquid") {
                return;
            }
            let mousePos = area.get_pointer();
            this.dragStart = { x: mousePos[0], y: mousePos[1] };
            this.mouseDown = true;
            if (this.processMouse(mousePos, "liquid")) {
                area.queue_draw();
            }
        });
        liquidGraph.connect('button_release_event', (area, dc, dc2) => {
            if (this.settings.mode != "custom+liquid") {
                return;
            }
            this.mouseDown = false;
            if (this.processMouse(area.get_pointer(), "liquid")) {
                area.queue_draw();
            }
            this.dragStart = null;
        });
        liquidGraph.connect('motion_notify_event', (area, dc) => {
            if (this.settings.mode != "custom+liquid") {
                return;
            }
            if (this.processMouse(area.get_pointer(), "liquid")) {
                area.queue_draw();
            }
        });
        liquidGraph.add_events(Gdk.EventMask.BUTTON_PRESS_MASK | Gdk.EventMask.BUTTON_RELEASE_MASK | Gdk.EventMask.BUTTON_MOTION_MASK | Gdk.EventMask.POINTER_MOTION_MASK);
        this.widgets.liquidGraph = cpuGraph;
        stackPanels[panelIdx].attach(liquidGraphHBox, 0, 0, 1, 1);
        ++panelIdx;


        modeSelect.connect( 'changed', ()=> {
            switch(this.widgets.mode.get_active()) {
                case 0: 
                    this.settings.mode = "fixed"; 
                    break;
                case 1: 
                    this.settings.mode = "custom";
                    break;
                case 2: 
                    this.settings.mode = "custom+liquid"; 
                    break;
            }
            cpuGraph.queue_draw();
            liquidGraph.queue_draw();
        });
        
        stack.add_titled(stackPanels[0], "critical",        "Critical Temps");
        stack.add_titled(stackPanels[1], "fixed",           "Fixed Speed");
        stack.add_titled(stackPanels[2], "custom-cpu",      "Custom (CPU)");
        stack.add_titled(stackPanels[3], "custom-liquid",   "Custom (Liquid)");

        let stackSwitcher = new Gtk.StackSwitcher({});
        stackSwitcher.stack = stack;
        box.add(stackSwitcher);
        box.add(stack);

        let revertButton = new Gtk.Button({label: "Revert"})
        revertButton.connect('clicked', () => {
            this.revertSettings();
        });

        let applyButton = new Gtk.Button({label: "Apply"})
        applyButton.connect('clicked', () => {
            this.applySettings();
        });


        let buttonBox = new Gtk.HBox({});
        buttonBox.add(revertButton);
        buttonBox.add(applyButton);
        box.add(buttonBox);

        outerBox.add(box);
        this.window.add(outerBox);

        if (this.dbusAdapter != null) {
            this.dbusAdapter.requestProps();
        }
    },
    // https://gist.github.com/mattdesl/47412d930dcd8cd765c871a65532ffac
    dist: function(point, x, y)
    {
        var dx = x - point.x;
        var dy = y - point.y;
        return Math.sqrt(dx * dx + dy * dy);
    },
    // https://gist.github.com/mattdesl/47412d930dcd8cd765c871a65532ffac
    // point - { x, y }
    // line - { sx, sx, ex, ey }
    distToSegment: function(point, line)
    {
        var dx = line.ex - line.sx;
        var dy = line.ey - line.sy;
        var l2 = dx * dx + dy * dy;
        
        if (l2 == 0) {
            return this.dist(point, line.sx, line.sy);
        }

        var t = ((point.x - line.sx) * dx + (point.y - line.sy) * dy) / l2;
        t = Math.max(0, Math.min(1, t));

        return this.dist(point, line.sx + t * dx, line.sy + t * dy);
    },
    distToLine: function(x, y, x0, y0, x1, y1) {
        return this.distToSegment({ x: x, y: y }, { sx: x0, sy: y0, ex: x1, ey: y1 });
    },
    processMouse: function(mousePos, source) {
        var dirty = false;
        let graphScale = 3;
        var prevRemoveOnDragEnd = this.removeOnDragEnd;
        this.removeOnDragEnd = false;
        let selectedCurves = [[source, 'pump'], [source, 'fan']];

        if (this.dragStart != null && this.selectedNode == null && this.selectedSegment != null) {
            // create a node under the mouse and select it immediately
            let curve = this.settings.curves[this.selectedSegment.curvePath[0]][this.selectedSegment.curvePath[1]];
            let graphOffsetX = 50;
            let graphOffsetY = 26;
            let newPos = { temp: Math.round((this.dragStart.x-graphOffsetX)/graphScale), speed: Math.round(100-((this.dragStart.y-graphOffsetY)/graphScale))};
            this.selectedNode = this.selectedSegment;
            this.selectedSegment = null;
            let insertAt = this.selectedNode.nodeIdx;
            curve.temp = curve.temp.slice(0, insertAt).concat([newPos.temp]).concat(curve.temp.slice(insertAt));
            curve.speed = curve.speed.slice(0, insertAt).concat([newPos.speed]).concat(curve.speed.slice(insertAt));
            dirty = true;
        }       

        if (this.dragStart != null && this.selectedNode != null) {
            let curve = this.settings.curves[this.selectedNode.curvePath[0]][this.selectedNode.curvePath[1]];
            let nodeIdx = this.selectedNode.nodeIdx;
            if (this.nodeOrigin == null) {
                // started dragging                
                this.nodeOrigin = { temp: curve.temp[ nodeIdx ], speed: curve.speed[ nodeIdx ] };
            } else {
                // dragging or end dragging
                let mouseDelta = { x: mousePos[0] - this.dragStart.x, y: mousePos[1] - this.dragStart.y };
                let newPos = (mouseDelta.x == 0 && mouseDelta.y == 0) ? this.nodeOrigin : { temp: Math.round(this.nodeOrigin.temp + mouseDelta.x/graphScale), speed: Math.round(this.nodeOrigin.speed - mouseDelta.y/graphScale)};

                let minVals = { fan: 25, pump: 60 };
                let maxVals = { fan: 100, pump: 100 };
                var minVal = minVals[ this.selectedNode.curvePath[1] ];
                var maxVal = maxVals[ this.selectedNode.curvePath[1] ];

                if (curve.temp.length > 2) {
                    let mergeBefore = nodeIdx > 0 && newPos.temp <= curve.temp[nodeIdx-1] && newPos.speed <= curve.speed[nodeIdx-1];
                    let mergeAfter = nodeIdx < (curve.temp.length-1) && newPos.temp >= curve.temp[nodeIdx+1] && newPos.speed >= curve.speed[nodeIdx+1];
                    if (mergeBefore || mergeAfter) {
                        this.removeOnDragEnd = true;
                        if (prevRemoveOnDragEnd != this.removeOnDragEnd) {
                            dirty = true;
                        }
                    }
                }

                if (nodeIdx > 0) {
                    newPos.temp = Math.max(newPos.temp, curve.temp[nodeIdx-1]+1);
                    newPos.speed = Math.max(newPos.speed, curve.speed[nodeIdx-1]);
                }
                if (nodeIdx < curve.temp.length-1) {
                    newPos.temp = Math.min(newPos.temp, curve.temp[nodeIdx+1]-1);
                    newPos.speed = Math.min(newPos.speed, curve.speed[nodeIdx+1]);
                }source

                newPos.temp = Math.max(Math.min(newPos.temp, 100), 0);
                newPos.speed = Math.max(Math.min(newPos.speed, maxVal), minVal);
                if (curve.temp[nodeIdx] != newPos.temp || curve.speed[nodeIdx] != newPos.speed) {
                    curve.temp[nodeIdx] = newPos.temp;
                    curve.speed[nodeIdx] = newPos.speed;
                    dirty = true;
                }
            }
            if (this.mouseDown == false) {
                this.nodeOrigin = null;
            }
            if (this.mouseDown == false && this.removeOnDragEnd) {
                this.removeOnDragEnd = false;
                dirty = true;
                curve.temp = curve.temp.slice(0, nodeIdx).concat(curve.temp.slice(nodeIdx+1));
                curve.speed = curve.speed.slice(0, nodeIdx).concat(curve.speed.slice(nodeIdx+1));
            }
        } else if (this.mouseDown == false) {
            var selectedNodeBefore = this.selectedNode;
            this.selectedNode = null;
            for (var idx = selectedCurves.length-1; idx >= 0; --idx) {
                let curvePath = selectedCurves[idx];
                let curve = this.settings.curves[curvePath[0]][curvePath[1]];
                var selectedNodeIdx = this.findNodeUnderMouse(mousePos, curve.temp, curve.speed);
                if (selectedNodeIdx >= 0) {
                    this.selectedNode = { curvePath: curvePath, nodeIdx: selectedNodeIdx };
                    break;
                }
            }
            if (selectedNodeBefore == null || this.selectedNode == null) {
                dirty |= selectedNodeBefore != this.selectedNode;
            } else {
                dirty |= selectedNodeBefore.curvePath[0] != this.selectedNode.curvePath[0] || selectedNodeBefore.curvePath[1] != this.selectedNode.curvePath[1] || selectedNodeBefore.nodeIdx != this.selectedNode.nodeIdx;
            }
        }

        // maybe a segment under the mouse?
//        let graphScale = 3;
        let graphOffsetX = 50;
        let graphOffsetY = 26;
        let graphHeight = 100*graphScale;
        let graphWidth = 100*graphScale;

        var selectedSegmentBefore = this.selectedSegment;
        this.selectedSegment = null;
        if (this.selectedNode == null) {            
            for (var idx = selectedCurves.length-1; idx >= 0; --idx) {
                let curvePath = selectedCurves[idx];
                let curve = this.settings.curves[curvePath[0]][curvePath[1]];
                for (var nodeIdx = 1; nodeIdx < curve.temp.length; ++nodeIdx) {
                    var x0 = graphOffsetX + ((curve.temp[nodeIdx-1]*graphScale)-2);
                    var y0 = graphOffsetY + (graphHeight-((curve.speed[nodeIdx-1]*graphScale)+2));
                    var x1 = graphOffsetX + ((curve.temp[nodeIdx]*graphScale)-2);
                    var y1 = graphOffsetY + (graphHeight-((curve.speed[nodeIdx]*graphScale)+2));

                    if (this.distToLine(mousePos[0], mousePos[1], x0, y0, x1, y1) < 4) {
                        this.selectedSegment = { curvePath: curvePath, nodeIdx: nodeIdx };
                    }
                }
            }
        }

        if (selectedSegmentBefore == null || this.selectedSegment == null) {
            dirty |= selectedSegmentBefore != this.selectedSegment;
        } else {
            dirty |= selectedSegmentBefore.curvePath[0] != this.selectedSegment.curvePath[0] || selectedSegmentBefore.curvePath[1] != this.selectedSegment.curvePath[1] || selectedSegmentBefore.nodeIdx != this.selectedSegment.nodeIdx;
        }

        return dirty;
    },
    findNodeUnderMouse: function(mousePos, temp, speed) {
        let xAxis = temp;
        let yAxis = speed;
        let graphScale = 3;
        let graphOffsetX = 50;
        let graphOffsetY = 26;
        let graphHeight = 100*graphScale;
        let graphWidth = 100*graphScale;

        for (var idx = xAxis.length-1; idx >= 0; --idx) {
            var px = graphOffsetX + ((xAxis[idx]*graphScale)-2);
            var py = graphOffsetY + (graphHeight-((yAxis[idx]*graphScale)+2));
            if (mousePos[0] >= px-2 && mousePos[1] >= py-2 && mousePos[0] <= px + 9 && mousePos[1] <= py + 9) {
                return idx;
            }
        }
        return -1;
    },
    drawTempGraph: function(cr, temp, speed, lineOnly, RGB, selectedNodeIdx, selectedSegmentIdx, curveName, labelIdx) {
        let width = 450;        
        let height = 360;
        

        let xAxis = temp;
        let yAxis = speed;

        let graphScale = 3;
        let graphOffsetX = 50;
        let graphOffsetY = 26;
        let graphHeight = 100*graphScale;
        let graphWidth = 100*graphScale;

        if (!lineOnly) {
            cr.setSourceRGB(0.0, 0.0, 0.0);
            cr.rectangle(0, 0, width, height);
            cr.fill();

            cr.setSourceRGB(0.4, 0.4, 0.4);
            cr.setLineWidth(1);
            for (var lineIdx = 0; lineIdx < 100; lineIdx += 10) {
                cr.moveTo(graphOffsetX + lineIdx*graphScale, graphOffsetY + 0);
                cr.lineTo(graphOffsetX + lineIdx*graphScale, graphOffsetY + graphHeight);
                cr.moveTo(graphOffsetX + 0, graphOffsetY + (graphHeight-(lineIdx*graphScale)));
                cr.lineTo(graphOffsetX + graphWidth, graphOffsetY + (graphHeight-(lineIdx*graphScale)));
                if (lineIdx == 0) {
                    cr.stroke();
                    cr.setDash([ 4.0, 6.0 ], 1);
                }
            }
            cr.stroke();
        }
        cr.setDash([], 0);

        if (!RGB) {
            cr.setSourceRGB(1.0, 1.0, 0.0);
        } else {
            cr.setSourceRGB(RGB[0], RGB[1], RGB[2]);
        }
        cr.setLineWidth(1);
        cr.moveTo(graphOffsetX, graphOffsetY + (graphHeight-(yAxis[0]*graphScale)));
        cr.lineTo(graphOffsetX + xAxis[0]*graphScale, graphOffsetY + (graphHeight-(yAxis[0]*graphScale)));
        for (var idx = 1; idx < xAxis.length; ++idx) {
            var px = xAxis[idx];
            var py = yAxis[idx];
            if (idx == selectedSegmentIdx) {
                cr.stroke();
                cr.setSourceRGB(1.0, 1.0, 1.0);
                cr.setLineWidth(3);
                cr.moveTo(graphOffsetX + xAxis[idx-1]*graphScale, graphOffsetY + (graphHeight-(yAxis[idx-1]*graphScale)));
                cr.lineTo(graphOffsetX + px*graphScale, graphOffsetY + (graphHeight-(py*graphScale)));
                cr.stroke();
                cr.setLineWidth(1);
                if (!RGB) {
                    cr.setSourceRGB(1.0, 1.0, 0.0);
                } else {
                    cr.setSourceRGB(RGB[0], RGB[1], RGB[2]);
                }
                cr.moveTo(graphOffsetX + px*graphScale, graphOffsetY + (graphHeight-(py*graphScale)));
            } else {
                cr.lineTo(graphOffsetX + px*graphScale, graphOffsetY + (graphHeight-(py*graphScale)));
            }
        }
        cr.lineTo(graphOffsetX + 100*graphScale, graphOffsetY + (graphHeight-(yAxis[yAxis.length-1]*graphScale)));
        cr.stroke();

        var selectedNodePos = null;
        var selectedNodeVal = null;
        cr.setSourceRGB(1.0, 0.0, 0.0);
        var needFill = false;
        for (var idx = 0; idx < xAxis.length; ++idx) {
            var px = graphOffsetX + ((xAxis[idx]*graphScale)-2);
            var py = graphOffsetY + (graphHeight-((yAxis[idx]*graphScale)+2));
            if (idx == selectedNodeIdx) {
                if (needFill) {
                    cr.fill();
                    needFill = false;
                }
                cr.setSourceRGB(1.0, 1.0, 1.0);
                cr.rectangle(px-2, py-2, 9, 9);
                cr.fill();
                cr.setSourceRGB(1.0, 0.0, 0.0);

                selectedNodePos = { x: px, y: py };
                selectedNodeVal = { x: xAxis[idx], y: yAxis[idx] };
            } else {
                cr.rectangle(px, py, 5, 5);
                needFill = true;
            }
        }
        if (needFill) {
            cr.fill();
        }

        let textHeight = 16;
        let textWidth = 16;
        let textOffsetX = 38;
        let textOffsetY = 22;

        if (this.selectedNode == null && !lineOnly) {
            cr.setSourceRGB(1.0, 0.0, 1.0);
            cr.setFontSize(textHeight);
            cr.selectFontFace( "Liberation Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD );
            for (var idx = 2; idx < 10; idx += 2) {
                var linePos = idx*10;
                cr.moveTo(graphOffsetX + linePos*graphScale - textWidth*0.5, graphOffsetY + graphHeight + textOffsetY);
                cr.showText(String(idx*10) + "°");
                cr.moveTo(graphOffsetX -textOffsetX, (graphOffsetY + (graphHeight-(linePos*graphScale)))+(textHeight*0.5-2));
                cr.showText(String(idx*10) + "%");
            }
        } else if (selectedNodePos != null) {
            cr.setSourceRGB(1.0, 0.0, 1.0);
            cr.setFontSize(textHeight);
            cr.selectFontFace( "Liberation Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD );
            let linePosX = selectedNodePos.x;                
            let linePosY = selectedNodePos.y;
            cr.moveTo(linePosX - textWidth*0.5, graphOffsetY + graphHeight + textOffsetY);
            cr.showText(String(selectedNodeVal.x) + "°");
            cr.moveTo(graphOffsetX -textOffsetX, linePosY+(textHeight*0.5-2));
            cr.showText(String(selectedNodeVal.y) + "%");

            if (this.removeOnDragEnd) { 
                var pixbuf = null;
                try {
                    pixbuf = Gtk.IconTheme.get_default().load_icon("edit-delete", 22, 22);
                } catch(e) {
                }

                if (pixbuf != null && pixbuf.get_width() >18 && pixbuf.get_width() <= 32 && pixbuf.get_height() >18 && pixbuf.get_height() <= 32) {
                    let pixels = pixbuf.get_pixels();
                    var prev_r = -1;
                    for (var ax = 0; ax < pixbuf.get_width(); ++ax) {
                        for (var ay = 0; ay < pixbuf.get_height(); ++ay) {
                            var offsetX = linePosX - (pixbuf.get_width()+0);
                            var offsetY = linePosY - (pixbuf.get_height()+0);
                            var a = Number(pixels[((ay*pixbuf.get_width()+ax)*4)+3])/255;
                            var r = Number(pixels[((ay*pixbuf.get_width()+ax)*4)+0]);
                            var g = Number(pixels[((ay*pixbuf.get_width()+ax)*4)+1]);
                            var b = Number(pixels[((ay*pixbuf.get_width()+ax)*4)+2]);
                            var avg = (r+g+b)*(1/3);
                            var r_out = (a*avg)/255;
                            r_out  = Math.min(1.0, r_out*3.0);
                            if (r_out > 0) {
                                if (r_out === prev_r) {
                                    cr.rectangle(ax + offsetX, ay + offsetY, 1, 1);
                                } else {
                                    if (prev_r >=(0|0)) {
                                        cr.fill();
                                    }
                                    cr.setSourceRGB(r_out,0,0);
                                    cr.rectangle(ax + offsetX, ay + offsetY, 1, 1);
                                    prev_r = r_out;
                                }
                            }
                        }
                    }
                    cr.fill();
                } else if (pixbuf != null) {
                    var offsetX = linePosX - (pixbuf.get_width()+0);
                    var offsetY = linePosY - (pixbuf.get_height()+0);
                    Gdk.cairo_set_source_pixbuf(cr, pixbuf, offsetX, offsetY);
                    cr.paint();
                } else {
                    var offsetX = linePosX - 26;
                    var offsetY = linePosY - 26;
                    cr.setLineWidth(2);
                    cr.setSourceRGB(1.0, 0.0, 0.0);
                    cr.moveTo(offsetX, offsetY);
                    cr.lineTo(offsetX + 22, offsetY + 22);
                    cr.moveTo(offsetX, offsetY + 22);
                    cr.lineTo(offsetX + 22, offsetY);
                    cr.stroke();
                }
            }
        }

        if ((this.selectedNode == null && this.selectedSegment == null) || selectedNodeIdx >= 0 || selectedSegmentIdx >=0) {
            cr.moveTo(graphOffsetX + graphWidth + 24, graphOffsetY + Math.round(graphHeight * 0.4) + labelIdx * (textHeight + 8));
            if (!RGB) {
                cr.setSourceRGB(1.0, 1.0, 0.0);
            } else {
                cr.setSourceRGB(RGB[0], RGB[1], RGB[2]);
            }
            cr.setFontSize(textHeight);
            cr.selectFontFace( "Liberation Sans", Cairo.FontSlant.NORMAL, Cairo.FontWeight.BOLD );
            cr.showText(curveName.charAt(0).toUpperCase() + curveName.slice(1));
        }
    },

    draw: function(area, cr, source) {
        // area is Gtk.DrawingArea
        // cr is Cairo.Context
        try {
            cr.scale(1, 1);

            let selectedCurves = [ [ source, 'pump'], [ source, 'fan' ] ];   

            var pumpTemp = this.settings.curves[source].pump.temp;
            var pumpSpeed = this.settings.curves[source].pump.speed;
            var fanTemp = this.settings.curves[source].fan.temp;
            var fanSpeed = this.settings.curves[source].fan.speed;

            var colors = [[0.0, 1.0, 1.0], [1.0, 1.0, 0.0]];            

            for (var idx in selectedCurves) {
                let curvePath = selectedCurves[idx];
                let curve = this.settings.curves[curvePath[0]][curvePath[1]];
                var selectedNodeIdx = -1;
                var selectedSegmentIdx = -1;
                if (this.selectedNode !== null && this.selectedNode.curvePath[0] == curvePath[0] && this.selectedNode.curvePath[1] == curvePath[1]) {
                    selectedNodeIdx = this.selectedNode.nodeIdx;
                }
                if (this.selectedSegment !== null && this.selectedSegment.curvePath[0] == curvePath[0] && this.selectedSegment.curvePath[1] == curvePath[1]) {
                    selectedSegmentIdx = this.selectedSegment.nodeIdx;
                }
                this.drawTempGraph(cr, curve.temp, curve.speed, idx>0, idx < idx.length ? colors[idx] : colors[colors.length-1], selectedNodeIdx, selectedSegmentIdx, curvePath[1], idx);
            }
            if ((source == "liquid" && this.settings.mode != 'custom+liquid') || this.settings.mode == 'fixed') {
                cr.setSourceRGBA(0.0, 0.0, 0.0, 0.6);
                cr.rectangle(0, 0, 1000, 1000);
                cr.fill();
            }
        } catch(e) {
            print("Error: " + e.message);
        }
    }
});

// connect to dbus
function connectToDBus() {
    let result = {
        onProps: null,
        requestProps: function() {},
        setConfig: function(config) {},
        getConfig: function() { return null; },
        boost: function() {}
    };

    let priv = {
        busWatchId: null,
        kcProxy: null,
        kcProxyPropertiesID: null,
        onProps: null,
        disconnectProxy: null,
        disconnectDBus: null,
        lastInfo: {
            KrakenDevice: null,
            LiquidTemp: null,
            CPUTemp: null,
            PumpDuty: null,
            FanDuty: null
        }            
    };

    priv.onProps = (proxy, changed, invalidated) => {
        var updates = false;
        [ "KrakenDevice", "LiquidTemp", "CPUTemp", "PumpDuty", "FanDuty" ].forEach((key) => {
            let value = proxy !== null ? proxy[key] : null;
            if (priv.lastInfo[key] != value) {
                updates = true;
                priv.lastInfo[key] = value;
            }
        });
        if (updates) {
            result.onProps(priv.lastInfo);
        }
    };

    priv.requestProps = () => {
        result.onProps(priv.lastInfo);
    };

    priv.disconnectProxy = () => {
        if (priv.kcProxy !== null && priv.kcProxyPropertiesID !== null) {
            priv.kcProxy.disconnect(priv.kcProxyPropertiesID);
        }    
        priv.kcProxy = null;
        priv.kcProxyPropertiesID = null;
        priv.onProps(null);
    };

    priv.disconnectDBus = () => {
        priv.disconnectProxy();
        if (priv.busWatchId !== null) {
            Gio.bus_unown_name(priv.busWatchId);
        }
        priv.busWatchId = null;
    };

    result.setConfig = (config) => {
        priv.kcProxy.UpdateConfigSync(JSON.stringify({
                mode: config.mode == "fixed" ? "fixed" : "custom",
                use_liquid_temp: config.mode == "cpu+liquid" ? true : false,
                cpu_critical: config.cpuCriticalTemp,
                liquid_critical: config.liquidCriticalTemp,
                boost_after_critical: config.boostAfterCritical,
                boost_duration: config.boostDuration,
                fixed_fan_speed: config.fixedFanDuty,
                fixed_pump_speed: config.fixedPumpDuty,
                cpu_pump_temp: config.curves.cpu.pump.temp,
                cpu_pump_speed: config.curves.cpu.pump.speed,
                cpu_fan_temp: config.curves.cpu.fan.temp,
                cpu_fan_speed: config.curves.cpu.fan.speed,
                liquid_pump_temp: config.curves.liquid.pump.temp,
                liquid_pump_speed: config.curves.liquid.pump.speed,
                liquid_fan_temp: config.curves.liquid.fan.temp,
                liquid_fan_speed: config.curves.liquid.fan.speed
        }));
    };

    result.getConfig = () => {
        let raw = JSON.parse(priv.kcProxy.GetConfigSync());
        if (raw == null) {
            return {
                mode: "",
                cpuCriticalTemp: 0,
                liquidCriticalTemp: 0,
                boostAfterCritical: false,
                boostDuration: 0,
                fixedFanDuty: 0,
                fixedPumpDuty: 0,
                curves: {
                    cpu: {
                        pump: {
                            temp: [0, 100],
                            speed: [0, 100]
                        },
                        fan: {
                            temp: [0, 100],
                            speed: [100, 0]
                        }
                    },
                    liquid: {
                        pump: {
                            temp: [0, 100],
                            speed: [0, 100]
                        },
                        fan: {
                            temp: [0, 100],
                            speed: [100, 0]
                        }
                    },
                }
            };
        } else {
            return {
                mode: raw.mode == "fixed" ? "fixed" : raw.use_liquid_temp ? "custom+liquid" : "custom",
                cpuCriticalTemp: raw.cpu_critical,
                liquidCriticalTemp: raw.liquid_critical,
                boostAfterCritical: raw.boost_after_critical,
                boostDuration: raw.boost_duration,
                fixedFanDuty: raw.fixed_fan_speed,
                fixedPumpDuty: raw.fixed_pump_speed,
                curves: {
                    cpu: {
                        pump: {
                            temp: raw.cpu_pump_temp,
                            speed: raw.cpu_pump_speed
                        },
                        fan: {
                            temp: raw.cpu_fan_temp,
                            speed: raw.cpu_fan_speed
                        }
                    },
                    liquid: {
                        pump: {
                            temp: raw.liquid_pump_temp,
                            speed: raw.liquid_pump_speed
                        },
                        fan: {
                            temp: raw.liquid_fan_temp,
                            speed: raw.liquid_fan_speed
                        }
                    }
                }
            };
        }
    };

    result.boost = function() {
        priv.kcProxy.BoostSync();
    };

    let ProxyWrapper = Gio.DBusProxy.makeProxyWrapper('\
    <node> \
        <interface name="net.mjjw.KrakenController"> \
            <method name=\'Boost\'> \
            </method> \
            <method name=\'GetConfig\'> \
                <arg type="s" name="config" direction="out" /> \
            </method> \
            <method name=\'UpdateConfig\'> \
                <arg type="s" name="config" direction="in" /> \
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

    priv.busWatchId = Gio.bus_watch_name(Gio.BusType.SYSTEM, 'net.mjjw.KrakenController', Gio.BusNameWatcherFlags.NONE, ()=>{
        try {
            priv.kcProxy = new ProxyWrapper(Gio.DBus.system, 'net.mjjw.KrakenController', '/net/mjjw/KrakenController' );
        } catch (e) {
            return;
        }

        priv.kcProxyPropertiesID = priv.kcProxy.connect('g-properties-changed', priv.onProps);
        priv.onProps(priv.kcProxy);
    }, () => {
        priv.disconnectProxy();
    });
    
    return result;
}

//Run the application
let app = new Application(connectToDBus());
app.run(ARGV);

