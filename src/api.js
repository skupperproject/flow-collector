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

const http = require('http');
const URL  = require('url');
const data = require('./data.js');

const SERVER_PORT = 8010;


const traverseDepthFirst = function(record, result) {
    result.push(record.obj);
    record.children.forEach(child => {
        traverseDepthFirst(child, result);
    });
}


const parseArgs = function(text) {
    let result = {};

    if (text) {
        let pairs = text.split('&');
        pairs.forEach(pair => {
            let sides = pair.split('=');
            if (sides.length == 2) {
                if (result[sides[0]] == undefined) {
                    //
                    // If this is the first instance of this key, put the key/value in the map
                    //
                    result[sides[0]] = sides[1];
                } else if (Array.isArray(result[sides[0]])) {
                    //
                    // If the key is already an array, add the new value to the end of the array.
                    //
                    result[sides[0]].push(sides[1]);
                } else {
                    //
                    // If the key is in the map, but the value is not an array,
                    // convert it to an array with the original value and the new value.
                    //
                    let original = result[sides[0]];
                    result[sides[0]] = [original, sides[1]];
                }
            }
        });
    }

    return result;
}


const argsWatch = function(args) {
    return args.watch && (args.watch == 'true' || args.watch == '1');
}

const argsIncludeDeleted = function(args) {
    return args.includeDeleted && (args.includeDeleted == 'true' || args.includeDeleted == '1');
}


const badRequest = function(res, reason) {
    res.statusCode    = 400;
    res.statusMessage = 'Bad Request'
    res.end(JSON.stringify({error:`Bad request - ${reason}`}));
}


const getVanAddrs = function(res, args) {
    let result = [];
    let vanAddrs = data.GetVanAddresses();
    for (const value of Object.values(vanAddrs)) {
        result.push(value.obj);
    }

    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(result));
    if (argsWatch(args)) {
        let watch = data.WatchRecord('VAN_ADDRESS', onRecordWatch, res);
        res.on('close', function() {
            data.UnwatchRecord('VAN_ADDRESS', watch);
            res.end();
        });
    } else {
        res.end();
    }
}


/**
 * Process a "flows" request.  Return van-address, listener, connector, and flow
 * records associated with the supplied van address.
 *
 * If the van address is unknown, an empty set will be returned and, if requested,
 * a watch will be established in case that address appears in the future.
 *
 * @param {http.ServerResponse} res HTTP response object
 * @param {*} args Arguments supplied with the GET query
 */
const getFlows = function(res, args) {
    res.setHeader('Content-Type', 'application/json');

    if (!args.vanaddr) {
        badRequest(res, 'vanaddr argument missing');
        return;
    }

    let result = [];
    let vaddr = data.GetVanAddresses()[args.vanaddr];
    if (vaddr) {
        result.push(vaddr.obj);
        vaddr.listenerIds.forEach(id => {
            let listener = data.GetRecords()[id];
            if (listener) {
                traverseDepthFirst(listener, result);
            }
        });
        vaddr.connectorIds.forEach(id => {
            let connector = data.GetRecords()[id];
            if (connector) {
                traverseDepthFirst(connector, result);
            }
        });
    }

    res.write(JSON.stringify(result));
    if (argsWatch(args)) {
        let watch = data.WatchFlows(args.vanaddr, onRecordWatch, res);
        res.on('close', function() {
            data.UnwatchFlows(args.vanaddr, watch);
            res.end();
        });
    } else {
        res.end();
    }
}


/**
 * General get processor for a single record type.
 *
 * @param {http.ServerResponse} res HTTP response on which to send the content
 * @param {string} rType The record type to be queried
 * @param {*} args Arguments supplied with the GET query
 */
const getRecordType = function(res, rType, args) {
    let result  = [];
    let records = data.GetRecords();

    //
    // Find all of the top-level records (that have no parent).
    //
    let linkIds = data.GetIdByType(rType);
    linkIds.forEach(id => result.push(records[id].obj));

    //
    // Send the JSON representation of the result.
    //
    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(result));
    if (argsWatch(args)) {
        let watch = data.WatchRecord(rType, onRecordWatch, res);
        res.on('close', function() {
            data.UnwatchRecord(rType, watch);
            res.end();
        });
    } else {
        res.end();
    }
}


/**
 * Process a topology query request.  Return all router records and link records representing
 * incoming links.  Since incoming and outgoing link records are redundant, this query filters
 * out the outgoing links to present a more efficient data set for the network topology.
 *
 * @param {http.ServerResponse} res HTTP response object
 * @param {*} args Arguments supplied with the GET query
 */
const getTopology = function(res, args) {
    let result  = [];
    let records = data.GetRecords();

    //
    // Get the IDs for routers and links
    //
    let routerIds = data.GetIdByType('ROUTER');
    let linkIds   = data.GetIdByType('LINK');

    //
    // Return the routers then the links
    //
    routerIds.forEach(id => {
        let router = records[id].obj;
        if (argsIncludeDeleted(args) || router.endTime == undefined) {
            result.push(router);
        }
    });
    linkIds.forEach(id => {
        let link = records[id].obj;
        if (link.direction == 'incoming' && (argsIncludeDeleted(args) || link.endTime == undefined)) {
            result.push(link);
        }
    });

    //
    // Send the JSON representation of the result.
    //
    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(result));
    if (argsWatch(args)) {
        let routerWatch = data.WatchRecord('ROUTER', onTopologyWatch, res);
        let linkWatch   = data.WatchRecord('LINK', onTopologyWatch, res);
        res.on('close', function() {
            data.UnwatchRecord('ROUTER', routerWatch);
            data.UnwatchRecord('LINK', linkWatch);
            res.end();
        });
    } else {
        res.end();
    }
}

const getRecord = function(res, args) {
    let result  = [];
    let records = data.GetRecords();
    let ids     = Array.isArray(args.id) ? args.id : [args.id];

    ids.forEach(id => {
        let record = records[id];
        if (record) {
            result.push(record._record);
        }
    })

    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(result));
    res.end();
}

/**
 * Watch handler for the topology query.  This handler filters out outgoing links to match
 * the results of the original topology list.
 *
 * @param {Record} record The record that triggered the watch
 * @param {http.ServerResponse} httpRes The HTTP response for the watch
 */
const onTopologyWatch = function(record, httpRes) {
    let obj = record.obj;
    if (obj.direction == undefined || obj.direction == 'incoming') {
        httpRes.write(JSON.stringify(obj));
    }
}


/**
 * General watch handler that doesn't do any filtering.  Simply generate a response
 * chunk that contains the JSON representation of the record.
 *
 * @param {Record} record The record that triggered the watch
 * @param {http.ServerResponse} httpRes The HTTP response for the watch
 */
const onRecordWatch = function(record, httpRes) {
    httpRes.write(JSON.stringify(record.obj));
}


const onRequest = function(req, res) {
    let parsed = URL.parse(req.url);
    let path   = parsed.pathname;
    let args   = parseArgs(parsed.query);
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    if (req.method == 'GET') {
        if (path.substring(0,14) == '/api/v1alpha1/') {
            path = path.substring(14)
            if (path == 'vanaddrs') {
                getVanAddrs(res, args);
                return;
            } else if (path == 'flows') {
                getFlows(res, args);
                return;
            } else if (path == 'links') {
                getRecordType(res, 'LINK', args);
                return;
            } else if (path == 'routers') {
                getRecordType(res, 'ROUTER', args);
                return;
            } else if (path == 'listeners') {
                getRecordType(res, 'LISTENER', args);
                return;
            } else if (path == 'connectors') {
                getRecordType(res, 'CONNECTOR', args);
                return;
            } else if (path == 'topology') {
                getTopology(res, args);
                return;
            } else if (path == 'record') {
                getRecord(res, args);
                return;
            }
        }
        badRequest(res, "Invalid GET Query");
        return;
    }

    badRequest(res, "Unsupported Method");
}


exports.Start = function() {
    return new Promise((resolve, reject) => {
        console.log('[API module starting]');
        http.createServer((req, res) => onRequest(req, res)).listen(SERVER_PORT);
        console.log(`API server listening on port ${SERVER_PORT}`);
        resolve();
    });
}