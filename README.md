# Authorize.net Boilerplate

This repo is not meant to be copy / pasted ( though largely could be ), however gives some stripped down code examples from a production application that uses Authorize.net's JS SDK to:

1. Create Customers
2. Create Payment Profiles
3. Charge Customers
4. Handle Webhook events
5. Get Payment details

I did not write ANY of this code, though I can speak to some of it, but there was 0 documentation prior to me joining, so my knowledge on WHY certain decision's were made is limited.

This code is probably not the best implementation, but it has proven to work fairly consistently.

**authorize-net-client.js** holds all of the root functions.
**payments-controllers** is where those root functions get called.
**payments-helpers** is just 2 functions to help a couple of controllers.
**authorize-net-error-codes.js** was an implementation to consolidate the enormous list of errors they can throw and what we mostly ran into.

Most of this is just ripped from https://github.com/AuthorizeNet/sample-code-node/tree/ef9e5c2d9e0379b5f47a0ebcb6847e711fe196ef because the Authorize.net documentation is so bad.

### Authorize.net portal

I'm not sure what additional setup is required within the authorize.net portal, but one thing for sure is the AVS ( Address Verification System ) being configured.

There are also some Velocity Flags that you'll probably want to disable. We literally had payments fail to go through because we had a spike in people trying to give us money. It was really dumb.
