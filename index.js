let protocolDecoderClass = require('./lib/protocol.js')

exports.processData = async function (buf, thisSocket, socketDataList) {
    let protocolDecoder;
    if(typeof thisSocket === 'undefined' || typeof socketDataList === 'undefined'){
        protocolDecoder = new protocolDecoderClass();
    } else {
        /*Step 1 - Check if this socket exists in socketDataList*/
        let index = socketDataList.findIndex((entry) => { return entry.socket.remoteAddress === thisSocket.remoteAddress && entry.socket.remotePort === thisSocket.remotePort; }) 
        /*Step 2 - If present, continue using already present protocolDecoderObject for a message stream in progress*/
        if (index !== -1) {
            protocolDecoder = socketDataList[index].socketProtocolDecoder;
        } else {
            /*Step 3 - If not present, add this socket and a new decoder object to protocolDataList and start using the decoder*/
            socketDataList.push({socket:thisSocket, socketProtocolDecoder: new protocolDecoderClass()})
            index = socketDataList.findIndex((entry) => { return entry.socket.remoteAddress === thisSocket.remoteAddress && entry.socket.remotePort === thisSocket.remotePort; }) 
            protocolDecoder = socketDataList[index].socketProtocolDecoder;   
        }
    }

    let data = buf

    args = { "rtuId": -1, "data": data, "originalData": data,
             "messageTypeText": {"0x00":"Hello",
                                 "0x04":"Record upload", 
                                 "0x05":"Commit request", 
                                 "0x14": "Canned response 1", 
                                 "0x22": "Canned response 2"}
    }

    let response = args
    response.data = data
    response.arrBufAllData = []
    try {
        response = await protocolDecoder.splitRawData(response)
        for (let i = 0; i < response.arrBufRawData.length; i++) {
            response.message = response.arrBufRawData[i]
            response = await protocolDecoder.processMessages(response)
        }

        let arrShapedData = []
        if(response.arrBufAllData?.length > 0){
            response.arrBufAllData.map((async allData => {
                let shapedData = {
                    values: {}
                }

                shapedData.values.TxFlag = allData.messageDetails.logReason
                shapedData.values.time = allData.messageDetails.deviceTime
                shapedData.values.sequenceNumber = allData.messageDetails.sequenceNumber
    
                allData.arrFields.map(async field => {
                    switch (field.fId) {
                        case (0): 
                            //GPS Data
                            let gpsData = {
                                gpsUTCDateTime: field.fIdData.readUInt32LE(0),
                                latitude: field.fIdData.readInt32LE(4) / 10000000,   //155614102128
                                longitude: field.fIdData.readInt32LE(8) / 10000000,
                                altitude: field.fIdData.readInt16LE(12),
                                groundSpeed2D: field.fIdData.readUInt16LE(14),
                                speedAccuracyEstimate: field.fIdData.readUInt8(16),
                                heading2d: field.fIdData.readUInt8(17),
                                PDOP: field.fIdData.readUInt8(18),
                                positionAccuracyEstimate: field.fIdData.readUInt8(19),
                                gpsStatusFlags: field.fIdData.readUInt8(20),
                            }
                            // gpsData.gpsUTCDateTime = await processData(gpsData.gpsUTCDateTime)
                            gpsData.gpsUTCDateTime = new Date()
                            shapedData.values.gpsData = gpsData
                            break
                        case (2):
                            //Digital Data
                            shapedData.values.digitalsIn = field.fIdData.readUInt32LE(0) //4 bytes
                            shapedData.values.digitalsOut = field.fIdData.readInt16LE(4) //2 bytes
                            shapedData.values.CI8 = field.fIdData.readInt16LE(6) //2 bytes
                            break
                        case (6):
                            //Ananlog Data 16bit
                            for (let i = 0; i < field.fIdData.length; i++) {
                                if(field.fIdData[i] === 1){
                                    shapedData.values.BATT = field.fIdData.readInt16LE(i + 1) / 1000
                                }
                                if(field.fIdData[i] === 2){
                                    shapedData.values.ExternalVoltage = (field.fIdData.readInt16LE(i + 1) / 1000) / 10
                                }
                                if(field.fIdData[i] === 3){
                                    shapedData.values.InternalTemperature = field.fIdData.readInt16LE(i + 1) / 100
                                }
                                if(field.fIdData[i] === 4){
                                    shapedData.values.SIG = field.fIdData.readInt16LE(i + 1)
                                }
                                if (field.fIdData.readUInt8(i) > 4) {
                                    shapedData.values[`AI${field.fIdData[i]}`] = field.fIdData.readInt16LE(i + 1)
                                }
                                i += 2
                            }
                            break
                        case (7): 
                            //Ananlog Data 32bit
                            for (let i = 0; i < field.fIdData.length; i++) {
                                try{
                                    shapedData.values[`AI${field.fIdData[i]}`] = field.fIdData.readInt32LE(i + 1)
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
            response.arrShapedData = arrShapedData
        }
    } catch (e) {
        console.error('PayloadDecoderError - unhandled processData Error', e);
        throw new Error(e);
    }
    return response;
}

exports.processTime = async function (digitalMattersTS) {
    let protocolDecoder = new protocolDecoderClass();
    let dmDate;

    try {
        dmDate = await protocolDecoder.processTime(digitalMattersTS)
    } catch (e) {
        console.error('PayloadDecoderError - unhandled processTime Error', e)
        throw new Error(e);
    }
    return dmDate
}