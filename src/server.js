const net = require('net');
const server = net.createServer();
server.on('connection', handleConnection);
server.listen(8000);
console.log('Listening on port 8000');

let endTransmission = false;

let transmission = new Buffer('', 'UTF8');
let reqHeaderBuf = new Buffer('', 'UTF8');

let respCode = 0;
let respMessage = '';
let respHeaders = {};

let contentLength = 0;
let blockCount = 0;
let totalSize = 0;

function getAllSocketData(socket) {
  let block = new Buffer('', 'UTF8');
  let chunk = new Buffer('', 'UTF8');

  while (true) {
    chunk = socket.read();
    if (chunk === null) break;
    block = Buffer.concat([block, chunk]);
  }

  return block;
}

function resetTransmission() {
  endTransmission = false;

  transmission = new Buffer('', 'UTF8');
  reqHeaderBuf = new Buffer('', 'UTF8');

  respCode = 0;
  respMessage = '';
  respHeaders = {};

  contentLength = 0;
  blockCount = 0;
  totalSize = 0;  
}

function handleConnection(socket) {
  socket.on('readable', () => {
    let block = getAllSocketData(socket);
    blockCount++;

    if (block.length > 0) {
      transmission = Buffer.concat([transmission, block]);

      if (reqHeaderBuf.length === 0) {
        /*
        *     If headers have not already been processed, this block is part of the 
        *     headers of the message
        * */
        let marker = transmission.indexOf('\r\n\r\n');
        if (marker !== -1) {
          /*
          *     Found the end-of-headers marker, so split headers from partial body 
          *     on this block and push the body data back onto the socket to be retrieved 
          *     with the next block
          * */
          let remaining = block.slice(marker + 4);
          reqHeaderBuf = transmission.slice(0, marker).toString();
          socket.unshift(remaining);
          totalSize = reqHeaderBuf.length;

          /*
          *     Reset the transmission; now that we have isolated the headers in reqHeaderBuf, 
          *     the transmission will only contain the body of the message
          * */
          transmission = new Buffer('', 'UTF8');
          console.log(`RECEIVED BLOCK ${blockCount} - SIZE ${reqHeaderBuf.length} - TOTAL SIZE ${totalSize}`);
          console.log(`HEADERS - SIZE ${reqHeaderBuf.length}`);

          /*
          *     Convert reqHeaderBuf to a map of values and create a full-on 
          *     request object (minus body) with all the info for the incoming message
          * */
          reqHeaders = reqHeaderBuf.split('\r\n');
          const reqInfo = reqHeaders.shift().split(' ');
          const headers = reqHeaders.reduce((remap, item) => { 
          const pair = item.split(': ');
            remap[pair[0].trim()] = pair[1].trim();
            return remap;
          }, {});
          const request = {
            method: reqInfo[0],
            url: reqInfo[1],
            httpVersion: reqInfo[2],
            headers,
            socket
          };

          // This is how much data we're expecting for the body
          contentLength = parseInt(headers['Content-Length']);
        } 
      } else {
        /*
        *     Headers have already been processed, so this block is part of the 
        *     body of the message
        * */
        totalSize += block.length + reqHeaders.length;
        console.log(`RECEIVED BLOCK ${blockCount} - SIZE ${block.length} - TOTAL SIZE ${totalSize}`);
      }      

      respHeaders = {};

      /*
      *     As long we haven't received all the data for the entire message, 
      *     send '100 Continue'; once all data of the body has been received, 
      *     send '200 OK' 
      * */
      if (totalSize < contentLength) {
        respCode = 100;
        respMessage = 'Continue';      
      } else {
        respHeaders['Content-Length'] = 0;
        respHeaders['X-My-Header'] = 'Brent';
        respCode = 200;
        respMessage = 'OK';
        endTransmission = true;
      }

      /*
      *     Build up the response headers 
      * */
      let outHeaders = '';
      for (let item in respHeaders) {
        if (respHeaders.hasOwnProperty(item)) {
          outHeaders += item + ': ' + respHeaders[item] + '\r\n';
        }
      }
      outHeaders += '\r\n';

      socket.write(`HTTP/1.1 ${respCode} ${respMessage}\r\n${outHeaders}`);
      if (endTransmission) {
        // Do this to treat next data coming in on the pipe as a new request
        resetTransmission();
      }
    }
  })
  .on('error', (error) => {
    console.log(`ERROR:\nSo this just happended:\n${error.toString()}`)
  });
}