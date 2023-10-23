class protocol{
    constructor(){
    }

    async splitRawData(args) {
        let response = args

        response.arrBufRawData = []
        let bufData = Buffer.from(response.data)
        try {
            /**
             * Handle packets of data appended to each other
            */
            for (let i = 0; i < bufData.length - 1; i++) {
                try {
                    if (i < bufData.length - 3) {
                        if (bufData[i] == 0x02 && bufData[i + 1] == 0x55) {
                            let payloadLen = bufData.readUInt16LE(i + 3)
                            response.arrBufRawData.push(bufData.subarray(i, i + 5 + payloadLen))
                            i = i + payloadLen + 4
                        }
                    }
                } catch (e) {
                    console.error('digitalMattersFalcon2GDriver error in loop processMessages', e)
                }
            }
        } catch (e) {
            response.e = e.e || e
            throw new Error(response);
        }
        return response;
    }

    async splitMultipleMessageData(args) {
        let response = args

        response.arrBufAllData = []

        try {
            /**
             * Separate multiple messages/DMT from arrBufRawData
            */
            for (let i = 0; i < response.arrBufRawData.length; i++) {
                let bufRawData = Buffer.from(response.arrBufRawData[i])
                try {
                    let payloadLenTotal = bufRawData.readUInt16LE(3)
                    for (let x = 5; x < payloadLenTotal; x++) {
                        let payloadLenMessage = bufRawData.readUInt16LE(x)
                        let bufMessage = bufRawData.slice(x, x + payloadLenMessage)
                        response.arrBufAllData.push({
                            bufRawData: response.arrBufRawData[i],
                            bufMessage: bufMessage,
                            arrFields: []
                        })
                        x = x + payloadLenMessage - 1
                    }
                    response = await this.splitMultipleRecordsData(response)
                } catch (e) {
                    console.error('digitalMattersFalcon2GDriver error in loop splitMultipleMessageData', e)
                }
            }
        } catch (e) {
            response.e = e.e || e
            throw new Error(response);
        }
        return response;
    }

    async processTime(digitalMattersTS){
        let a;
        try {
            let timeBase = new Date('01/01/2013').getTime()
            a = (timeBase + (digitalMattersTS * 1000))
        } catch (e) {
            console.error('ProcessTime Error', e)
            throw new Error(e);
        }
    
        return a;
    }

    async splitMultipleRecordsData(args) {
        let response = args

        try {
            for (let i = 0; i < response.arrBufAllData.length; i++) {
                let bufMessage = response.arrBufAllData[i].bufMessage
                let bufMessageMessageLen = bufMessage.readUInt16LE(0)
                let sequenceNumber = bufMessage.readUInt16LE(2)
                let rtcDateTime = bufMessage.readUInt32LE(6)
                let deviceTime = await this.processTime(rtcDateTime)
                let logReason = bufMessage.readUInt8(10)
                response.arrBufAllData[i].messageDetails = {
                    sequenceNumber: sequenceNumber,
                    rtcDateTime: rtcDateTime,
                    deviceTime: deviceTime,
                    logReason: logReason
                }
                for (let y = 11; y < bufMessage.length; y++) {
                    let fId = bufMessage.readUInt8(y)
                    let fIdLen = bufMessage.readUInt8(y + 1)
                    let fIdData = bufMessage.slice(y + 2, y + 2 + fIdLen)
                    y = y + 1 + fIdLen
                    response.arrBufAllData[i].arrFields.push({ 
                        fId: fId, 
                        fIdData: fIdData
                    })
                }
            }
        } catch (e) {
            response.e = e.e || e
            throw new Error(response)
        }

        return response;
    }

    async processMessages(args) {
        let response = args
        try {
            let finalBuf
            let buf = Buffer.from(response.message)
            response.msgType = buf[2].toString(16).padStart(2, '0').toUpperCase()
            response.msgType = '0x' + response.msgType
            switch (response.msgType) {
                case ('0x00'):    //Hello from Device
                    let helloFromDevice = {
                        sync1: buf.readUInt8(0), //1 bytes
                        sync2: buf.readUInt8(1), //1 bytes
                        msgType: buf.readUInt8(2), //1 bytes
                        payloadLen: buf.readUInt16LE(3), //2 bytes
                        serialNumber: buf.readUInt32LE(5), //4 bytes
                        modemIMEI: buf.slice(9, 16).toString(),  //16 bytes
                        simSerial: buf.slice(25, 21).toString(), //21 bytes
                        productId: buf.readUInt8(46), //1 byte
                        hardwareRevisionNumber: buf.readUInt8(47), //1 byte
                        firmwareMajor: buf.readUInt8(48), //1 byte
                        firmwareMinor: buf.readUInt8(49), //1 byte
                        flags: buf.readUInt32LE(50), //4 bytes
                    }
    
                    response.rtuId = helloFromDevice.serialNumber
    
                    let timeBase = new Date('01/01/2013').getTime()
                    let timeNow = Math.floor((new Date().getTime() - timeBase) / 1000)
                    let timeBuf = Buffer.alloc(4)
                    timeBuf.writeUInt32LE(timeNow)

                    let helloToDevice = {
                        sync1: Buffer.from([0x02]), //1 bytes
                        sync2: Buffer.from([0x55]), //1 bytes
                        msgType: Buffer.from([0x01]), //1 bytes
                        payloadLen: Buffer.from([0x08, 0x00]), //2 bytes
                        bufDateTime: Buffer.from(timeBuf), //4 bytes
                        code: Buffer.from([0x00, 0x00, 0x00, 0x00])
                    }
                    finalBuf = Buffer.concat(Object.values(helloToDevice))
                    response.responseToDevice = finalBuf
                    break
                case ('0x04'):
                    /**
                     * Data Record Upload from Device to Server. This can contain muiltiple records
                     * Data Extraction
                     * If there is data that the device has not yet sent, it will send it. Refer to the DMT data fields document for the data format:
                    */
                    response = await this.splitMultipleMessageData(response)
                    break
                case ('0x05'):
                    /**
                     * Commit Request
                     * A commit request will be sent from the device when data is sent. It waits for acknowledgement to ensure the data arrived and can be deleted
                    */
                    let commitRequestFromDevice = {
                        sync1: buf.readUInt8(0), //1 bytes
                        sync2: buf.readUInt8(1), //1 bytes
                        msgType: buf.readUInt8(2), //1 bytes
                        payloadLen: buf.readUInt16LE(3), //2 bytes
                    }

                    let commitToDevice = {
                        sync1: Buffer.from([0x02]), //1 bytes
                        sync2: Buffer.from([0x55]), //1 bytes
                        msgType: Buffer.from([0x06]), //1 bytes
                        payloadLen: Buffer.from([0x01, 0x00]), //2 bytes
                        commitStatus: Buffer.from([0x01]), //1 bytes
                    }

                    finalBuf = Buffer.concat(Object.values(commitToDevice))
                    response.responseToDevice = finalBuf
                    break
                case ('0x14'):
                    /**
                     * Cannned response 1
                    */
                     let messageNeedingCannedResponse1 = {
                        sync1: buf.readUInt8(0), //1 bytes
                        sync2: buf.readUInt8(1), //1 bytes
                        msgType: buf.readUInt8(2), //1 bytes
                        payloadLen: buf.readUInt16LE(3), //2 bytes
                        payload: new DataView(5, buf.readUInt16LE(3)) //payloadLen bytes
                    }

                    let cannedResponse1ToDevice = {
                        sync1: Buffer.from([0x02]), //1 bytes
                        sync2: Buffer.from([0x55]), //1 bytes
                        msgType: Buffer.from([0x15]), //1 bytes
                        payloadLen: Buffer.from([0x0C, 0x00]), //2 bytes
                        body: Buffer.from([0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]), //12 bytes
                    }

                    finalBuf = Buffer.concat(Object.values(cannedResponse1ToDevice))
                    response.responseToDevice = finalBuf

                    break
                case ('0x22'):
                    /**
                     * Cannned response 2
                    */
                    let messageNeedingCannedResponse2 = {
                        sync1: buf.readUInt8(0), //1 bytes
                        sync2: buf.readUInt8(1), //1 bytes
                        msgType: buf.readUInt8(2), //1 bytes
                        payloadLen: buf.readUInt16LE(3), //2 bytes
                    }

                    let cannedResponse2ToDevice = {
                        sync1: Buffer.from([0x02]), //1 bytes
                        sync2: Buffer.from([0x55]), //1 bytes
                        msgType: Buffer.from([0x23]), //1 bytes
                        payloadLen: Buffer.from([0x00, 0x00]), //2 bytes
                    }

                    finalBuf = Buffer.concat(Object.values(cannedResponse2ToDevice))
                    response.responseToDevice = finalBuf

                    break
                default:
                    /**
                     * Unhandled message, ignore
                    */
                    console.error('Unhandled msgType', msgType);
                    break;
            }    
        } catch (e) {
            response.e = e.e || e
            throw new Error(e);
        }
        return response;
    }
}
module.exports = protocol