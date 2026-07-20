console.log('require electron:', typeof require('electron'));
console.log('process.type:', process.type);
if (typeof require('electron') === 'object') {
  console.log('app:', typeof require('electron').app);
  console.log('BrowserWindow:', typeof require('electron').BrowserWindow);
}
