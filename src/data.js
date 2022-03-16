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

class Record {
    constructor(rtype, id, rec) {
        this._rtype       = rtype;
        this._id          = id;
        this._record      = rec;
        this._children    = [];

        if (this.parent) {
            records[this.parent].addChild(this.id);
        }
    }

    get id() {
        return this._id;
    }

    get parent() {
        return this._record[record.PARENT_INDEX];
    }

    get children() {
        let childObjects = [];
        this._children.forEach(childId => {
            childObjects.push(records[childId]);
        });
        return childObjects;
    }

    get counterflow() {
        return this._record[record.COUNTERFLOW_INDEX];
    }

    get obj() {
        let object = this._record;
        object.rtype = this._rtype;
        object.id    = this.id;
        return object;
    }

    addChild(childId) {
        this._children.push(childId);
    }

    update(rec) {
        let prevParent = this.parent;
        for (const [key, value] of Object.entries(rec)) {
            this._record[key] = value;
        }
        if (!prevParent && this.parent) {
            records[this.parent].addChild(this.id);
        }
    }
}

var records = {};

exports.IncomingRecord = function(rtype, id, record) {
    if (!records[id]) {
        records[id] = new Record(rtype, id, record);
    } else {
        records[id].update(record);
    }
    console.log(records[id].obj);
}

exports.GetRecords = function() {
    return records;
}