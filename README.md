# Use this library to decode the tcp flexi-protocol data which Digital Matter devices send and receive.


The device sends tcp packets with header bytes. These packets can be received contactinated onto each other. This library separates them and builds up an array
of individual messages.
Individual messages can be **flexi length**. This library handles them accordingly and places the results into an array. It also builds up an object with the data placed
in the **response.values** object for ease of use. You can however ignore this object and build your own from the array that is returned.

# To use call function .processData(<raw tcp Buffer data from the device>)
eg: 
`const DMemTCPProtocolDecoder = require('DMemTCPProtocolDecoder'); `
`let response = await DMemTCPProtocolDecoder.processData(<raw tcp Buffer data from the device>)`

## What you probably most interrested in is you get a nice neat object back with the DMT values:

### response.values
                {
                    time: 1620170944,
                    TxFlag: 11,
                    digitalsIn: 0,
                    digitalsOut: 0,
                    AI1: 4094,
                    AI2: 30,
                    AI3: 2239,
                    AI4: 29,
                    AI...........(depending on what the unit is configured to send)
                    BATT: 4.094,
                    SIG: 29,
                    InternalTemperature: 29,
                    ExternalVoltage: 5
                }



This library will provide the **hello response** buffer data to be sent to device when it sends a hello
This library provides the **commit response** buffer data to be sent to the device to notify it that the data has been recieved and processed by the server. Note that you need to build your logic up around this. You need to decide
when you would like to commit or not based on errors you may have writing to your db.

# response.arrBufAllData
This holds all the data split up accordingly.

# allData.arrFields
This holds the individual message data such as GPS location, digital inputs and analogs.

# Original credit for this library goes to: shane@bitid.co.za
