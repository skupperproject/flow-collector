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

`/api/v1alpha1/topology`

This query returns a list of `ROUTER` and `LINK` records.  The `LINK` records shall be filtered such that only those with a direction of `incoming` will be provided.  This is sufficient information to completely display the network topology.

`ROUTER`

|Attribute|Description|
|---------|-----------|
|`namespace`|If applicable, the Kubernetes namespace in which the router is running.|
|`imageName`|The name of the image running the router.|
|`imageVersion`|The version of the image.|
|`hostname`|The hostname or pod name holding this router.|
|`name`|The name of the router as referenced in the network topology.|
|`buildVersion`|The build version for the router code.|

`LINK`

|Attribute|Description|
|---------|-----------|
|`parent`|The router that issued this link record.|
|`mode`|`interior` for links between interior routers, `edge` for links between edge routers and interior routers.|
|`name`|The name of the peer router, i.e. the router to which this link connects.|
|`linkCost`|The cost configured for this link.|
|`direction`|`outgoing` for links established from this router.  `incoming` for links established by the peer router.|

---
`api/v1alpha1/links`

This query returns the entire set of links, including `incoming` and `outgoing` directions.  Note that every inter-router link will be represented by two records: one from the perspective of each linked router.

---
`api/v1alpha1/vanaddrs`

This query does not return VAN-Flow records.  It simply returns a list of address strings.  Each address represents a service that is exposed across the network.

---
`api/v1alpha1/flows?vanaddr=<address>`

This query returns records that are related to traffic flows for a particular service.  The records types are `LISTENER` for ingress points, `CONNECTOR` for egress points to running server pods, and `FLOW` for units of communication between listeners and connectors.

`LISTENER`

|Attribute|Description|
|----|----|
|`parent`|The ID of the router on which this listener is configured.|
|`destHost`|The hostname or IP address on which this listener is exposed.|
|`destPort`|The port on which this listener is exposed.|
|`protocol`|The protocol over which service is offered by this listener.|
|`vanAddress`|The VAN address used to route traffic over the network.|

`CONNECTOR`

|Attribute|Description|
|----|----|
|`parent`|The ID of the router on which this connector is configured.|
|`destHost`|The destination host or IP address for the running service/pod.|
|`destPort`|The port over which the running service/pod offers access.|
|`vanAddress`|The VAN address used to route traffic over the network.|

`FLOW`

Flow records are uni-directional which means that almost all protocol traffic will be described by two flow records, one for the client-to-server direction and another for the server-to-client direction.

|Attribute|Description|
|----|----|
|`parent`|The ID of the `LISTENER` or `CONNECTOR` record that is the endpoint for this flow.|
|`counterflow`|The ID of the flow representing the other direction of traffic flow for this protocol exchange.|
|`sourceHost`|The hostname or IP address of the source side of this connection.  The destination side IP can be determined from this record's parent.|
|`sourcePort`|The port of the source side of this connection.|
|`octets`|The number of octets carried over this flow.  Note that for long-lived flows, this value will increase over time.|
|`latency`|The latency experienced for this flow.  For client-side flows (the parent is a listener), this is the latency experienced by the client.  For server-side flows (the parent is a connector), this is the latency of the actual server/pod handling the traffic.  The cross-network latency can be computed by finding the difference between the two latencies.|
|`trace`|A list (separated by vertical bar characters) of the routers through which this traffic flowed.|
