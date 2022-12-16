/*
 Licensed to the Apache Software Foundation (ASF) under one
 or more contributor license agreements.  See the NOTICE file
 distributed with this work for additional information
 regarding copyright ownership.  The ASF licenses this file
 to you under the Apache License, Version 2.0 (the
 "License"); you may not use this file except in compliance
 with the License.  You may obtain a copy of the License at
   http://www.apache.org/licenses/LICENSE-2.0
 Unless required by applicable law or agreed to in writing,
 software distributed under the License is distributed on an
 "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 KIND, either express or implied.  See the License for the
 specific language governing permissions and limitations
 under the License.
*/

"use strict";

const record = require('./record.js');

var next_identifier = 0;

const local_identifier = function() {
    let text = `col:${next_identifier}`;
    next_identifier += 1;
    return text;
}

/**
 * VanAddress
 *
 * Van addresses are not emitted as records from routers.  They are inferred from other data
 * and stored by the collector in VanAddress objects.
 */
class VanAddress {
    constructor(vaddr) {
        this._identity     = local_identifier();
        this._address      = vaddr;
        this._listenerIds  = [];
        this._connectorIds = [];
        this._totalFlows   = 0;
        this._currentFlows = 0;

        vanAddresses[vaddr] = this;
        this._fireWatches();
    }

    _fireWatches() {
        let watchList = recordWatches['VAN_ADDRESS'] || [];
        watchList.forEach(watch => watch.invoke(this))

        watchList = flowWatches[this._address] || [];
        watchList.forEach(watch => watch.invoke(this));
    }

    addListenerId(id) {
        this._listenerIds.push(id);
        this._fireWatches();
    }

    addConnectorId(id) {
        this._connectorIds.push(id);
        this._fireWatches();
    }

    flowBegin() {
        this._totalFlows   += 1;
        this._currentFlows += 1;
        this._fireWatches();
    }

    flowEnd() {
        this._currentFlows -= 1;
        this._fireWatches();
    }

    get address() {
        return this._address;
    }

    get listenerIds() {
        return this._listenerIds;
    }

    get connectorIds() {
        return this._connectorIds;
    }

    get obj() {
        let object = {};
        object.recordType     = 'VAN_ADDRESS';
        object.identity       = this._identity;
        object.name           = this._address;
        object.listenerCount  = this._listenerIds.length;
        object.connectorCount = this._connectorIds.length;
        object.totalFlows     = this._totalFlows;
        object.currentFlows   = this._currentFlows;
        return object;
    }
}

/**
 * Record
 *
 * This class holds records emitted by event sources in the network.
 */
class Record {
    constructor(rtype, id, rec) {
        this._rtype        = rtype;
        this._id           = id;
        this._record       = rec;
        this._children     = [];         // List of records IDs
        this._peerId       = undefined;
        this._van_address  = undefined;
        this._parentLinked = false;
        this._timeoffset   = undefined;

        //
        // Store this record's identity in the by-type index.
        //
        idsByType[this._rtype].push(this._id);

        //
        // If this record has a counter-flow attribute, create a mutual cross reference
        // with the counter-flow record.
        //
        this._linkPeer();

        //
        // If this is a LISTENER or CONNECTOR record, do inference regarding the van address
        // of the record.  This includes possibly creating a new VanAddress object or changing
        // metrics of an existing one.
        //
        if (this._rtype == "LISTENER" || this._rtype == "CONNECTOR") {
            this._newVanAddress();
        }

        if (this._van_address && this._record.endTime) {
            this._van_address.flowBegin();
            this._van_address.flowEnd();
        }

        //
        // If this is a record type that participates in process linkage, queue it up in the
        // to-be-reconciled list.
        //
        if (this._rtype == "CONNECTOR") {
            toBeProcessReconciled.connectors.push(this._id);
        } else if (this._rtype == "PROCESS") {
            toBeProcessReconciled.processes.push(this._id);
        } else if (this._rtype == "FLOW") {
            toBeProcessReconciled.flows.push(this._id);
        }

        //
        // Normalize LINK names to contain the "0/" prefix if they don't already have it.
        // This will allow for proper matching of the linked name to a ROUTER record.
        //
        if (this._rtype == "LINK") {
            if (this._record['name'] && this._record['name'][0] != '0') {
                this._record['name'] = "0/" + this._record['name'];
            }
        }

        //
        // If this record has a parent reference, set up the parent-child linkage.
        //
        if (this.parent) {
            this._addParent();
        }

        //
        // If there are any watches relevant to this record, invoke them now.
        //
        this._fireWatches();
    }

    get id() {
        return this._id;
    }

    get rtype() {
        return this._rtype;
    }

    get parent() {
        return this._record[record.PARENT_INDEX];
    }

    get childIds() {
        return this._children;
    }

    get children() {
        let childObjects = [];
        this._children.forEach(childId => {
            childObjects.push(records[childId]);
        });
        return childObjects;
    }

    get counterflowId() {
        return this._record[record.COUNTERFLOW_INDEX];
    }

    get timeOffset() {
        return this._timeoffset;
    }

    get obj() {
        let object = this._record;
        object.recordType = this._rtype;
        object.identity   = this.id;
        if (object.endTime) {
            object.duration = object.endTime - object.startTime;
        } else {
            let ancestor = this;
            let now      = undefined;
            while (ancestor && !now) {
                if (ancestor.timeOffset) {
                    now = (Date.now() * 1000) + ancestor.timeOffset;
                    break;
                }
                let aid = ancestor.parent;
                ancestor = aid ? records[aid] : undefined;
            }
            if (now) {
                object.duration = now - object.startTime;
            }
        }
        return object;
    }

    setTime(timestamp) {
        this._timeoffset = (Date.now() * 1000) - timestamp;
    }

    attribute(attr) {
        return this._record[attr];
    }

    _addParent() {
        if (this.parent in records) {
            let parent = records[this.parent];
            parent.addChild(this.id);
            this._parentLinked = true;
            if (parent._van_address) {
                this._van_address = parent._van_address;
                if (this._rtype == 'FLOW') {
                    this._van_address.flowBegin()
                }
            }
        }
    }

    _linkPeer() {
        let peerId = this.counterflowId;
        if (peerId) {
            let peerRecord = records[peerId];
            if (peerRecord) {
                this._peerId = peerId;
                let update = {};
                update[record.COUNTERFLOW_INDEX] = this._id;
                peerRecord.update(update);
            }
        }
    }

    _newVanAddress() {
        let addr = this._record[record.VAN_ADDRESS_INDEX];
        if (addr) {
            let vanAddr = vanAddresses[addr];
            if (vanAddr == undefined) {
                vanAddr = new VanAddress(addr);
            }

            if (this._rtype == "LISTENER") {
                vanAddr.addListenerId(this._id);
            } else {
                vanAddr.addConnectorId(this._id);
            }

            this._van_address = vanAddr;
        }
    }

    _fireWatches() {
        let watches = recordWatches[this._rtype] || [];
        watches.forEach(watch => watch.invoke(this));

        if (this._van_address) {
            let watches = flowWatches[this._van_address.address] || [];
            watches.forEach(watch => watch.invoke(this));
        }
    }

    addChild(childId) {
        this._children.push(childId);
    }

    update(rec) {
        let prevAddr = this._record[record.VAN_ADDRESS_INDEX];
        
        for (const [key, value] of Object.entries(rec)) {
            this._record[key] = value;
        }
        
        if (!!this.parent && !this._parentLinked) {
            this._addParent(this.parent);
        }

        if ((this._rtype == "LISTENER" || this._rtype == "CONNECTOR") && !prevAddr) {
            this._newVanAddress();
        }

        if (this._rtype == 'FLOW' && !this._peerId) {
            this._linkPeer();
        }

        if (this._van_address && this._record.endTime) {
            this._van_address.flowEnd();
        }

        this._fireWatches();
    }
}

class Watch {
    constructor(onUpdate, arg1) {
        this._onUpdate = onUpdate;
        this._arg1     = arg1;
    }

    invoke(record) {
        this._onUpdate(record, this._arg1);
    }
}

//
// Reconcile process linkage for the newly created or updated ID.
//
const reconcileProcessLinkage = function(id) {
    let record = records[id];
    if (record.rtype == "CONNECTOR") {
        //
        // Connector - If the connector is pending reconciliation and the connector's destination host 
        // has a process record associated with it, create the linkage and remove the connector from the
        // reconciliation list.
        //
        if (toBeProcessReconciled.connectors.indexOf(id) > -1) {
            let processIp = record.attribute("destHost");
            if (processIp && processIps[processIp]) {
                toBeProcessReconciled.connectors.splice(toBeProcessReconciled.connectors.indexOf(id), 1);
                record.update({
                    process : processIps[processIp],
                });

                //
                // Recursively reconcile all FLOW records that are children of this CONNECTOR
                //
                record.childIds.forEach(childId => reconcileProcessLinkage(childId));
            }
        }
    } else if (record.rtype == "PROCESS") {
        //
        // Process - If the process is pending reconciliation and the process has a SOURCE_HOST,
        // store (or overwrite) the record in the processIps index.
        //
        if (toBeProcessReconciled.processes.indexOf(id) > -1 && record.attribute("sourceHost") && record.attribute("imageName")) {
            let ip = record.attribute("sourceHost");
            processIps[ip] = id;
            toBeProcessReconciled.processes.splice(toBeProcessReconciled.processes.indexOf(id), 1);

            //
            // Recursively reconcile all CONNECTOR and FLOW records awaiting reconciliation.
            //
            toBeProcessReconciled.connectors.forEach(id => reconcileProcessLinkage(id));
            toBeProcessReconciled.flows.forEach(id => reconcileProcessLinkage(id));

            //
            // Infer the image record and set up the linkage
            //
            let iname = record.attribute("imageName");
            let iid   = images[iname];

            if (iid == undefined) {
                iid = local_identifier();
                let irecord = new Record('IMAGE', iid, {
                    name : iname,
                });
                images[iname] = iid;
                records[iid] = irecord;
            }

            records[id].update({
                image : iid,
            });
    }
    } else if (record.rtype == "FLOW") {
        //
        // Flows - If the flow is a child of a connector, and the connector has a processes link,
        // copy the link and be done.  If the flow is a child of a listener and the sourceHost of
        // the flow is found in the processIps, create the linkage.
        //
        let parent = records[record.parent];
        if (parent) {
            if (parent.rtype == "CONNECTOR") {
                if (parent.attribute('process')) {
                    toBeProcessReconciled.flows.splice(toBeProcessReconciled.flows.indexOf(id), 1);
                    record.update({
                        process : parent.attribute("process"),
                    });
                }
            } else if (parent.rtype == "LISTENER") {
                let ip = record.attribute("sourceHost");
                if (ip && ip in processIps) {
                    toBeProcessReconciled.flows.splice(toBeProcessReconciled.flows.indexOf(id), 1);
                    record.update({
                        process : processIps[ip],
                    });
                }
            } else {
                toBeProcessReconciled.flows.splice(toBeProcessReconciled.flows.indexOf(id), 1);
            }
        }
    }
}

//
// records - All accumulated records keyed by their identities.
//
var records = {};

//
// idsByType - Identities of records keyed by record type.
//
var idsByType = {
    'SITE'       : [],
    'ROUTER'     : [],
    'LINK'       : [],
    'CONTROLLER' : [],
    'LISTENER'   : [],
    'CONNECTOR'  : [],
    'FLOW'       : [],
    'PROCESS'    : [],
    'IMAGE'      : [],
    'INGRESS'    : [],
    'EGRESS'     : [],
};

//
// vanAddresses - { vanAddress => VanAddress object }
//
var vanAddresses = {};

//
// images - { imageName => objectId }
//
var images = {};

//
// Record-Type watches - { recordType => [Watch] }
//
var recordWatches = {
    'SITE'        : [],
    'ROUTER'      : [],
    'LINK'        : [],
    'CONTROLLER'  : [],
    'LISTENER'    : [],
    'CONNECTOR'   : [],
    'FLOW'        : [],
    'PROCESS'     : [],
    'IMAMGE'      : [],
    'INGRESS'     : [],
    'EGRESS'      : [],
    'VAN_ADDRESS' : [],
};

//
// Process IP addresses - { ipAddress => id of process record }
//
var processIps = {};

//
// Lists of records that possibly require process-linkage-reconciliation
//
var toBeProcessReconciled = {
    connectors : [],
    processes  : [],
    flows      : [],
}

//
// Flow watches - { vanAddr => [Watch] }
//
var flowWatches = {};


exports.IncomingRecord = function(rtype, id, record) {
    if (!records[id]) {
        //console.log(`Incoming New Record ${rtype}/${id}`);
        records[id] = new Record(rtype, id, record);
    } else {
        records[id].update(record);
    }
    reconcileProcessLinkage(id);
}

exports.GetRecords = function() {
    return records;
}

exports.GetIdByType = function(type) {
    return idsByType[type];
}

exports.GetVanAddresses = function() {
    return vanAddresses;
}

exports.WatchRecord = function(rType, onUpdate, arg1) {
    let watch = new Watch(onUpdate, arg1);
    recordWatches[rType].push(watch);
    console.log(`Watch established for type ${rType}`);
    return watch;
}

exports.UnwatchRecord = function(rType, watch) {
    recordWatches[rType] = recordWatches[rType].filter(w => w != watch);
    console.log(`Watch cancelled for type ${rType}`);
}

exports.WatchFlows = function(vanaddr, onUpdate, arg1) {
    let watch = new Watch(onUpdate, arg1);
    if (flowWatches[vanaddr] == undefined) {
        flowWatches[vanaddr] = [];
    }
    flowWatches[vanaddr].push(watch);
    console.log(`Flow watch established for vanaddr ${vanaddr}`);
    return watch;
}

exports.UnwatchFlows = function(vanaddr, watch) {
    flowWatches[vanaddr] = flowWatches[vanaddr].filter(w => w != watch);
    console.log(`Flow watch cancelled for vanaddr ${vanaddr}`);
}

exports.SourceTimestamp = function(id, timestamp) {
    if (records[id]) {
        records[id].setTime(timestamp);
    }
}
