let protocolDecoderClass = require('./lib/protocol.js')

exports.processData = async function (buf, thisSocket, socketDataList = [{rtuId: -1, arrShapedData : []}]) {
    let protocolDecoder = new protocolDecoderClass();
    let index = 0;
    let timeBase = new Date('01/01/2013').getTime()

    if(typeof thisSocket !== 'undefined'){
        /*Step 1 - Check if this socket exists in socketDataList*/
        index = socketDataList.findIndex((entry) => { return entry.socket.remoteAddress === thisSocket.remoteAddress && entry.socket.remotePort === thisSocket.remotePort; }) 
        /*Step 2 - If not present, persist rtuId and all message data*/
        if (index !== -1) {
            socketDataList[index].rtuId = -1; 
            socketDataList[index].arrShapedData = []
        }
        else{
            throw Error('Cant find this socket\'s data')
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
            response = await protocolDecoder.processMessages(response, socketDataList[index])
        }
        if(response.arrBufAllData?.length > 0){
            response.arrBufAllData.map(async allData => {  
                let shapedData = {};             
                shapedData["TxFlag"] = allData.messageDetails.logReason
                shapedData["time"] = Math.floor((timeBase + (allData.messageDetails.rtcDateTime * 1000))/1000)
                shapedData["sequenceNumber"] = allData.messageDetails.sequenceNumber
                allData.arrFields.map(async field => {
                    switch (field.fId) {
                        case (0): 
                            //GPS Data
                            shapedData.gpsUTCDateTime = Math.floor((timeBase + (field.fIdData.readUInt32LE(0) * 1000))/1000)
                            shapedData.latitude = field.fIdData.readInt32LE(4) / 10000000
                            shapedData.longitude = field.fIdData.readInt32LE(8) / 10000000
                            shapedData.location = `(${shapedData.latitude}, ${shapedData.longitude})`
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
                            //Analog Data 32bit
                            for (let i = 0; i < field.fIdData.length; i++) {
                                try{
                                    shapedData[`AI${field.fIdData[i]}`] = field.fIdData.readInt32LE(i + 1)
                                }catch(e){
                                    console.error(`Analog Data 32 bit error for field.fIdData[i] ${field.fIdData[i]}`, e)
                                }
                                i += 4
                            }
                            break
                        case (15): 
                            shapedData.DeviceTripType = field.fIdData.readUInt8(0) //1 bytes
                            shapedData.TripTrimmingAmount = field.fIdData.readInt16LE(1) //2 bytes
                            break
                        default:
                            console.error('PayloadDecoderError - unhandled splitMultipleRecordsData case fId', field.fId);
                            break
                    }
                })
                socketDataList[index].arrShapedData.push({...shapedData})             
            })
            response.arrShapedData = socketDataList[index].arrShapedData
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