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
const data = require('./data.js');

const SERVER_PORT = 8000;
var server;


const traverseDepthFirst = function(record, result) {
    result.push(record.obj);
    record.children.forEach(child => {
        traverseDepthFirst(child, result);
    });
}


const onAll = function(req, res) {
    let records = data.GetRecords();
    let topLevel = [];

    //
    // Find all of the top-level records (that have no parent).
    //
    for (const [key, record] of Object.entries(records)) {
        if (record.parent == undefined) {
            topLevel.push(record);
        }
    }

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
    res.end(JSON.stringify(result));
}


const onRequest = function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    let path = req.url;
    if (path.substr(0,8) == '/api/v1/') {
        if (path.substr(8,3) == 'all') {
            onAll(req, res);
            return;
        }
    }

    res.writeHead(404);
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