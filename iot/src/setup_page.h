#pragma once

// Embedded so the setup page works before the board has internet access.
static const char setupPage[] PROGMEM = R"IRIS(<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light"><title>IRIS · Wi-Fi setup</title>
<style>
:root{font:16px/1.45 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#17212b;background:#f3f6f7}
*{box-sizing:border-box}body{margin:0;padding:28px 14px}main{max-width:610px;margin:auto}
header{padding:0 3px 14px}.brand{color:#12685e;font-size:12px;font-weight:800;letter-spacing:.15em}
h1{font-size:28px;letter-spacing:-.03em;margin:5px 0}p{margin:4px 0;color:#56656f}
section{background:white;border:1px solid #dbe3e8;border-radius:14px;padding:20px}
h2{font-size:18px;margin:0 0 4px}label{display:block;font-weight:650;margin:16px 0 5px}
select,input,button{font:inherit;border-radius:9px;width:100%;min-height:46px;padding:9px 12px}
select,input{border:1px solid #bccacf;background:white;color:inherit}
button{border:0;cursor:pointer;font-weight:700;margin:14px 0 0;background:#12685e;color:white}
button.secondary{background:#e9eff1;color:#17212b}button:disabled{opacity:.55;cursor:wait}
button:focus-visible,select:focus-visible,input:focus-visible{outline:3px solid #91c9be;outline-offset:2px}
.show{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:400}.show input{min-height:18px;width:18px}
#status{font-size:14px;margin:14px 0 0;padding:11px 12px;background:#e9f3f7;border-radius:9px}
#status[data-kind=error]{color:#822b25;background:#fff0ed}#status[data-kind=success]{color:#176b45;background:#e7f5ed}
</style></head><body><main>
<header><span class="brand">IRIS · APPLIANCE BOARD</span><h1>Wi-Fi setup</h1></header>
<section><h2>Connect to Wi-Fi</h2><p>Choose the 2.4 GHz network the board should use.</p>
<form id="form"><button id="scan" class="secondary" type="button">Scan for networks</button>
<label for="network">Nearby networks</label><select id="network"><option value="">Enter network name manually</option></select>
<div id="manual"><label for="ssid">Network name</label><input id="ssid" maxlength="32" required autocomplete="off" autocapitalize="none" spellcheck="false"></div>
<label for="wifi">Wi-Fi password</label><input id="wifi" type="password" maxlength="63" autocomplete="current-password" placeholder="Leave blank for an open network">
<label class="show"><input id="show" type="checkbox">Show password</label>
<button id="connect" type="submit">Save network and connect</button></form>
<p id="status" role="status" aria-live="polite">Stay connected to the board until setup finishes.</p>
</section></main><script>
const el=id=>document.getElementById(id);
const network=el('network'), manual=el('ssid'), wifi=el('wifi'), scan=el('scan'), connect=el('connect');
function notice(message,kind=''){el('status').textContent=message;el('status').dataset.kind=kind}
function selectNetwork(){el('manual').hidden=!!network.value;manual.required=!network.value}
network.onchange=selectNetwork;
el('show').onchange=()=>{wifi.type=el('show').checked?'text':'password'};
scan.onclick=async()=>{
  scan.disabled=connect.disabled=true;notice('Scanning nearby networks…');
  try{
    const response=await fetch('/scan',{cache:'no-store'});
    if(!response.ok)throw Error('Scan failed. Try again or enter the network name.');
    const rows=await response.json(), old=network.value;
    const names=new Set();
    network.replaceChildren(new Option('Enter network name manually',''));
    for(const row of rows.sort((a,b)=>b.rssi-a.rssi)){
      if(!row.ssid || names.has(row.ssid))continue;
      names.add(row.ssid);network.add(new Option(row.ssid+' · '+row.rssi+' dBm',row.ssid));
    }
    network.value=names.has(old)?old:(manual.value?'':network.options[1]?.value||'');
    selectNetwork();
    notice(names.size?'Choose your network or enter its name manually.':'No networks found. Enter a name or scan again.');
  }catch(e){notice(e.message,'error')}
  finally{scan.disabled=connect.disabled=false}
};
el('form').onsubmit=async event=>{
  event.preventDefault();if(connect.disabled)return;
  scan.disabled=connect.disabled=true;notice('Checking the Wi-Fi connection…');
  try{
    const response=await fetch('/connect',{method:'POST',body:new URLSearchParams({ssid:network.value||manual.value,wifi:wifi.value})});
    const result=await response.json();if(!response.ok)throw Error(result.message);
    wifi.value='';notice('Connected. The board is restarting. You can rejoin your usual Wi-Fi.','success');
  }catch(e){notice(e.message||'Reconnect to the board and try again.','error');scan.disabled=connect.disabled=false}
};
scan.click();
</script></body></html>)IRIS";
