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

const attributes = ["identity",      "parent",      "startTime",   "endTime",
                    "counterflow",   "peer",        "process",     "sib_ordinal",
                    "location",      "provider",    "platform",    "namespace",
                    "mode",          "source_host", "dest_host",   "protocol",
                    "source_port",   "dest_port",   "van_address", "image_name",
                    "image_version", "hostname",    "flow_type",   "octets",
                    "start_latency", "backlog",     "method",      "result",
                    "reason",        "name",        "trace",       "build_version",
];

const refAttributes = [true,  true,  false, false,
                       true,  true,  false, false,
                       false, false, false, false,
                       false, false, false, false,
                       false, false, false, false,
                       false, false, false, false,
                       false, false, false, false,
                       false, false, false, false,
];

exports.PARENT_INDEX      = "parent";
exports.COUNTERFLOW_INDEX = "counterflow";


const adjustValue = function(value, key) {
    if (refAttributes[key]) {
        return `${value[0]}:${value[1]}:${value[2]}`;
    } else {
        return value;
    }
}


exports.FlowToRecord = function(flow) {
    var id;
    let record = {};
    for (const [key, value] of Object.entries(flow)) {
        if (key == 0) {
            id = adjustValue(value, key);
        } else {
            record[attributes[key]] = adjustValue(value, key);
        }
    }
    return [id, record];
}
