# flow-collector
Prototype Skupper VAN-Flow Collector

This project is in the prototype phase.  It is intended primarily for research and development for cross-network instrumentation in Skupper VANs (Virtual Application Networks).  It presently has a number of limitations that make it unsuitable for production use.

## Introduction

The Skupper Router generates logs from the FLOW_LOG source that describe, in detail, the interactions between protocol endpoints in a Skupper VAN.  Because of the distributed nature of a VAN and the fact that proptocol endpoints (clients and servers) are often in different cloud locations, compiling a meaningful view of the overall operation of a distributed application is difficult.  It involves manually correlating logs from multiple sources.

Furthermore, due to the abstract nature of Skupper, IP addresses and ports are only of local significance, being seen only in the cloud site in which the protocol endpoint resides.  This means that IP addresses and ports cannot be used to associate logs for traffic that flows between and through multiple sites.

To address these problems, the Skupper team has introduced VAN-Flow.  VAN-Flow, similar to NETFlow, involves the emission of events (that roughly parallel the FLOW_LOG logs) from various sources, including the Skupper Router and other Skupper control-plane components.  These events can then be collected and coalesced into a single unified view of what is happening on the entire network.

This project is an implementation of such a collector.

## Deployment of the Flow Collector

The easiest way to deploy the Flow Collector is to apply the deployment yaml provided in the root directory of this project repository within the context of one of the sites in your VAN:

```kubectl apply -f deploy.yaml```

This will deploy the Flow Collector alongside the Skupper Router in the namespace.  The Flow Collector will register its presence with the Skupper Router, and as a result, every router in the VAN will begin emitting VAN-Flow events to be collected by the Flow Collector.

The deployment yaml will also create a Kubernetes service called `skupper-collector` that may be used for ingress from a web browser or other REST-enabled client or console for the display of the unified network data.
