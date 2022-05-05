# flow-collector
Prototype Skupper VAN-Flow Collector

This project is in the prototype phase.  It is intended primarily for research and development for cross-network instrumentation in Skupper VANs (Virtual Application Networks).  It presently has a number of limitations that make it unsuitable for production use.

## Introduction

The Skupper Router generates logs from the FLOW_LOG source that describe, in detail, the interactions between protocol endpoints in a Skupper VAN.  Because of the distributed nature of a VAN and the fact that protocol endpoints (clients and servers) are often in different cloud locations, compiling a meaningful view of the overall operation of a distributed application is difficult.  It involves manually correlating logs from multiple sources.

Furthermore, due to the abstract nature of Skupper, IP addresses and ports are only of local significance, being seen only in the cloud site in which the protocol endpoint resides.  This means that IP addresses and ports cannot be used to associate logs for traffic that flows between and through multiple sites.

To address these problems, the Skupper team has introduced VAN-Flow.  VAN-Flow, similar to NETFlow, involves the emission of events (that roughly parallel the FLOW_LOG logs) from various sources, including the Skupper Router and other Skupper control-plane components.  These events can then be collected and coalesced into a single unified view of what is happening on the entire network.

This project is an implementation of such a collector.

## Deployment of the Flow Collector

The easiest way to deploy the Flow Collector is to apply the deployment yaml provided in the root directory of this project repository within the context of one of the sites in your VAN:

```kubectl apply -f deploy.yaml```

This will deploy the Flow Collector alongside the Skupper Router in the namespace.  The Flow Collector will register its presence with the Skupper Router, and as a result, every router in the VAN will begin emitting VAN-Flow events to be collected by the Flow Collector.

The deployment yaml will also create a Kubernetes service called `skupper-collector` that may be used for ingress from a web browser or other REST-enabled client or console for the display of the unified network data.

## Flow Collector API

The API query strings are all prefixed with `/api/v1alpha1/`.  The responses are all in JSON format, generally in the form of a list of records.

### Record Types

Queries into the Flow Collector result (most of the time) in a list of records.  The following record types are returned by the Flow Collector:

|Type|Description|
|----|-----------|
|`ROUTER`|A router in the network.|
|`LINK`|A connection between two routers in the network.|
|`LISTENER`|An ingress point for protocol endpoints - provides service access to clients.|
|`CONNECTOR`|An egress point for protocol endpoints - corresponds to server instances.|
|`FLOW`|A unidirectional flow of application service traffic between protocol endpoints.|

### Common Record Attributes

The VAN-Flow records come in a number of various types.  Many of the types share common attributes.  This is a table of attributes found in most or all of the different record types:

|Attribute|Description|
|---------|-----------|
|`rtype`|The type of the record.|
|`id`|A unique identifier for this record.|
|`parent`|The identifier of the parent of this record.|
|`startTime`|Timestamp for the creation of this record.|
|`endTime`|Timestamp for the destruction of this record.  If present, the object no longer exists.  If not present, the object is still active.|

### Queries

`/api/v1alpha1/routers`

This query returns a list of `ROUTER` records having the following attributes:

|Attribute|Description|
|---------|-----------|
|`namespace`|If applicable, the Kubernetes namespace in which the router is running.|
|`imageName`|The name of the image running the router.|
|`imageVersion`|The version of the image.|
|`hostname`|The hostname or pod name holding this router.|
|`name`|The name of the router as referenced in the network topology.|
|`buildVersion`|The build version for the router code.|

`api/v1alpha1/links`

This query returns a list of `LINK` records.  Note that each router reports all of its inter-router links.  This means that for every inter-router connection, two `LINK` records will be provided, one from each router's perspective.

|Attribute|Description|
|---------|-----------|
|`parent`|The router that issued this link record.|
|`mode`|`interior` for links between interior routers, `edge` for links between edge routers and interior routers.|
|`name`|The name of the peer router, i.e. the router to which this link connects.|
|`linkCost`|The cost configured for this link.|
|`direction`|`outgoing` for links established from this router.  `incoming` for links established by the peer router.|
