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
var server;


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
                result[sides[0]] = sides[1];
            }
        });
    }

    return result;
}


const isWatch = function(args) {
    return args.watch && (args.watch == 'true' || args.watch == '1');
}


const badRequest = function(res, reason) {
    res.statusCode    = 400;
    res.statusMessage = 'Bad Request'
    res.end(JSON.stringify({error:`Bad request - ${reason}`}));
}


const onAll = function(res) {
    let records = data.GetRecords();
    let topLevel = [];

    //
    // Find all of the top-level records (that have no parent).
    //
    let topLevelIds = data.GetTopLevelIds();
    topLevelIds.forEach(id => topLevel.push(records[id]));

    //
    // Add decendents of the top-level records depth first so
    // we report parents before children.
    //
    let result = [];
    topLevel.forEach(record => {
        traverseDepthFirst(record, result);
    });

    //
    // Send the JSON representation of the result.
    //
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(result));
}


const onVanAddrs = function(res, args) {
    let result = [];
    let vanAddrs = data.GetVanAddresses();
    for (const value of Object.values(vanAddrs)) {
        result.push(value.obj);
    }

    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(result));
    if (isWatch(args)) {
        let watch = data.WatchRecord('VAN_ADDRESS', onRecordWatch, res);
        res.on('close', function() {
            data.UnwatchRecord('VAN_ADDRESS', watch);
        });
    } else {
        res.end();
    }
}


const onFlows = function(res, args) {
    res.setHeader('Content-Type', 'application/json');

    if (!args.vanaddr) {
        badRequest(res, 'vanaddr argument missing');
        return;
    }

    let result = [];
    let vaddr = data.GetVanAddresses()[args.vanaddr];
    if (vaddr) {
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
    if (isWatch(args)) {
        let watch = data.WatchFlows(args.vanaddr, onRecordWatch, res);
        res.on('close', function() {
            data.UnwatchFlows(args.vanaddr, watch);
        });
    } else {
        res.end();
    }
}


const onRecordType = function(res, rType, args) {
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
    if (isWatch(args)) {
        let watch = data.WatchRecord(rType, onRecordWatch, res);
        res.on('close', function() {
            data.UnwatchRecord(rType, watch);
        });
    } else {
        res.end();
    }
}


const onTopology = function(res, args) {
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
        if (args.includeDeleted || router.endTime == undefined) {
            result.push(router);
        }
    });
    linkIds.forEach(id => {
        let link = records[id].obj;
        if (link.direction == 'incoming' && (args.includeDeleted || link.endTime == undefined)) {
            result.push(link);
        }
    });

    //
    // Send the JSON representation of the result.
    //
    res.setHeader('Content-Type', 'application/json');
    res.write(JSON.stringify(result));
    if (isWatch(args)) {
        let routerWatch = data.WatchRecord('ROUTER', onTopologyWatch, res);
        let linkWatch   = data.WatchRecord('LINK', onTopologyWatch, res);
        res.on('close', function() {
            data.UnwatchRecord('ROUTER', routerWatch);
            data.UnwatchRecord('LINK', linkWatch);
        });
    } else {
        res.end();
    }
}


const onTopologyWatch = function(record, httpRes) {
    let obj = record.obj;
    if (obj.direction == undefined || obj.direction == 'incoming') {
        httpRes.write(JSON.stringify(obj));
    }
}


const onRecordWatch = function(record, httpRes) {
    httpRes.write(JSON.stringify(record.obj));
}


const onRequest = function(req, res) {
    let parsed = URL.parse(req.url);
    let path   = parsed.pathname;
    let args   = parseArgs(parsed.query);
    console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);
    if (path.substring(0,14) == '/api/v1alpha1/') {
        path = path.substring(14)
        if (path.substring(0,3) == 'all') {
            onAll(res);
            return;
        } else if (path.substring(0,8) == 'vanaddrs') {
            onVanAddrs(res, args);
            return;
        } else if (path.substring(0,5) == 'flows') {
            onFlows(res, args);
            return;
        } else if (path.substring(0,5) == 'links') {
            onRecordType(res, 'LINK', args);
            return;
        } else if (path.substring(0,7) == 'routers') {
            onRecordType(res, 'ROUTER', args);
            return;
        } else if (path.substring(0,8) == 'topology') {
            onTopology(res, args);
            return;
        }
    }

    res.end("Invalid Request");
}


exports.Start = function() {
    return new Promise((resolve, reject) => {
        console.log('[API module starting]');
        server = http.createServer((req, res) => onRequest(req, res)).listen(SERVER_PORT);
        console.log(`API server listening on port ${SERVER_PORT}`);
        resolve();
    });
}