class protocol{
    constructor(){
        this.arrShapedData = []
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
    
                    response.rtuId = helloFromDevice.serialNumber;
                    this.dataToCommit.rtuId = helloFromDevice.serialNumber;
    
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
        /*Various messages are persisted here, persisting it within the object*/
        if(response.arrBufAllData?.length > 0){
            response.arrBufAllData.map((async allData => {
                let shapedData = {}
                shapedData.TxFlag = allData.messageDetails.logReason
                shapedData.time = allData.messageDetails.rtcDateTime
                shapedData.time = Math.floor(await this.processTime(shapedData.time)/1000)
                shapedData.sequenceNumber = allData.messageDetails.sequenceNumber
    
                allData.arrFields.map(async field => {
                    switch (field.fId) {
                        case (0): 
                            //GPS Data
                            shapedData.gpsUTCDateTime = field.fIdData.readUInt32LE(0)
                            shapedData.gpsUTCDateTime = Math.floor(await this.processTime(shapedData.gpsUTCDateTime)/1000)
                            shapedData.latitude = field.fIdData.readInt32LE(4) / 10000000,   //155614102128
                            shapedData.longitude = field.fIdData.readInt32LE(8) / 10000000,
                            shapedData.altitude = field.fIdData.readInt16LE(12)
                            shapedData.groundSpeed2D = field.fIdData.readUInt16LE(14)
                            shapedData.speedAccuracyEstimate = field.fIdData.readUInt8(16)
                            shapedData.heading2d = field.fIdData.readUInt8(17)
                            shapedData.PDOP = field.fIdData.readUInt8(18)
                            shapedData.positionAccuracyEstimate = field.fIdData.readUInt8(19)
                            shapedData.gpsStatusFlags = field.fIdData.readUInt8(20)
                            break
                        case (2):
                            //Digital Data
                            shapedData.digitalsIn = field.fIdData.readUInt32LE(0) //4 bytes
                            shapedData.digitalsOut = field.fIdData.readInt16LE(4) //2 bytes
                            shapedData.CI8 = field.fIdData.readInt16LE(6) //2 bytes
                            break
                        case (6):
                            //Analog Data 16bit
                            for (let i = 0; i < field.fIdData.length; i++) {
                                if(field.fIdData[i] === 1){
                                    shapedData.BatteryVoltage = field.fIdData.readInt16LE(i + 1) / 1000
                                }
                                if(field.fIdData[i] === 2){
                                    shapedData.ExternalVoltage = (field.fIdData.readInt16LE(i + 1) / 10) / 10
                                }
                                if(field.fIdData[i] === 3){
                                    shapedData.InternalTemperature = field.fIdData.readInt16LE(i + 1) / 100
                                }
                                if(field.fIdData[i] === 4){
                                    shapedData.cellularSignaldBm = field.fIdData.readInt16LE(i + 1)
                                }
                                if (field.fIdData.readUInt8(i) > 4) {
                                    shapedData[`AI${field.fIdData[i]}`] = field.fIdData.readInt16LE(i + 1)
                                }
                                i += 2
                            }
                            break
                        case (7): 
                            //Ananlog Data 32bit
                            for (let i = 0; i < field.fIdData.length; i++) {
                                try{
                                    shapedData[`AI${field.fIdData[i]}`] = field.fIdData.readInt32LE(i + 1)
                                }catch(e){
                                    console.error(`Analog Data 32 bit error for field.fIdData[i] ${field.fIdData[i]}`, e)
                                }
                                i += 4
                            }
                            break
                        default:
                            console.error('PayloadDecoderError - unhandled splitMultipleRecordsData case fId', field.fId)
                    }
                })
                arrShapedData.push(shapedData)
            }))
            response.arrShapedData = this.arrShapedData;
        }
        return response;
    }
}
module.exports = protocol