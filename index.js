'use strict';

const jsdom         = require('jsdom');
const { JSDOM }     = jsdom;
const querystring   = require('querystring');
const ssdp          = require('node-ssdp').Client;
const debug         = require('debug')('aiseg2');

const PORT = 80;
const headers = {
    // これらヘッダがないとエラーになる
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent':   'Node.js',
};
// シャッター操作定義
const opList = {
    open:  '0',
    close: '1',
    stop:  '2'
};

// addressをURLに
function addr2host(address) {
    return 'http://' + address;
}

// <br>を除去した名前を取得
function parseAisegName(col) {
    if (col.length < 1) {
        return '';
    }
    return col[0].innerHTML.replace(/(<br>)/gi, '');
}

// 空気環境の温度と湿度を取得
function parseAisegAirEnvironment(col) {
    if (col.length < 1) {
        return '';
    }
    const el = col[0].getElementsByTagName('div');
    let temp = '';
    for (let j = 0; j < el.length; j++) {
        let d = el[j].className.match(/num no([0-9])/)
        if (d) {
            temp += d[1];
        }
        if (el[j].className == 'num_dot') {
            temp += '.';
        }
    }
    return temp;
}

// 初期化
// opt.username: AiSEG2にhttp接続するユーザ名
// opt.password: AiSEG2にhttp接続するパスワード
var aiseg2 = function(opt) {
    this.opList = opList;
    this.digestRequest = require('request-digest')(opt.username, opt.password);
};

// AiSEG2のIPアドレスを得る
// ssdpプロトコルでAiSEG2のurnを検索し、resolve()経由でIPアドレスが得られる
aiseg2.prototype.discover = function() {
    return new Promise((resolve, reject) => {
        let client = new ssdp();
        let timer  = null;
        client.on('response', (headers, statusCode, rinfo) => {
            // AiSEG2を発見
            if (timer != null) {
                clearTimeout(timer);
                timer = null;
            }
            client.stop();
            resolve(rinfo.address);
        });
        client.search('urn:panasonic-com:service:p60AiSeg2DataService:1');
        timer = setTimeout(() => {
            // タイムアウト
            timer = null;
            client.stop();
            reject(new Error('Can\'t found AiSEG2'));
        }, 5000);
    });
};

// AiSEG2に設定されているシャッターの一覧を得る
// 下記のようなオブジェクトの配列がresolve()経由で得られる
// 得られた配列の1要素をdoShutter()に渡すことで、シャッターを操作できる
//
// retObj = [
//   'ガレージシャッター': {
//     nodeId: '268566528',
//     eoj:    '0x026301',
//     type:   '0x0e',
//     agree:  '0x31',
//     name:   'ガレージシャッター',
//     state:  '0x30',
//     entry:  '1',
//     shutter: {
//         openState: '0x43',
//         type:      '0x1010',
//         version:   '1'
//     },
//     condition: '開動作中'
//   }
// ];
//
aiseg2.prototype.getShutter = async function(address) {
    let host = addr2host(address);
    try {
        // シャッターを検索する
        // うちはシャッターが3つしかないためこれでいけるが、それを越える場合は別のページも取得しないといけないかも
        let response = await this.digestRequest.requestAsync({
            host:    host,
            path:    '/page/devices/device/325?' + querystring.stringify({
                page:  '1'
            }),
            port:    PORT,
            method:  'GET',
            headers: headers
        });
        // 下記のような形式で埋め込まれている機器リストを抜き出す
        // <script type="text/javascript">window.onload = init([{"nodeId":"268...
        let deviceList = {};
        const dom = new JSDOM(response.body);
        const script = dom.window.document.querySelectorAll('script:not([src])');
        for (let i = 0; i < script.length; i++) {
            let list = script[i].textContent.match(/window\.onload = init\(([^)]+)\)/);
            if (list) {
                let obj = JSON.parse(list[1]);
                // 抜き出した機器リストの各要素をnameで判定して各機器のテーブルに振り分ける
                for (let j = 0; j < obj.length; j++) {
                    deviceList[obj[j].name] = obj[j];
                }
            }
        }
        debug(`aiseg2.getShutter: ${deviceList}`);
        return deviceList;
    } catch (err) {
        // AiSEG2のシャッター一覧応答を得られなかった
        throw new Error('Can\'t get AiSEG2 shutter list.');
    }
};

// シャッター開/閉/停止
// address: discover()で得たAiSEG2のアドレス
// device: getShutterで得たシャッターリストのうち1つ
// op: opListで定義されている開/閉/停止のうち1つ
aiseg2.prototype.doShutter = async function(address, device, op) {
    try {
        let host = addr2host(address);
        // まずトークンを得るために機器からhtmlを読み出す。
        let response = await this.digestRequest.requestAsync({
            host:    host,
            path:    '/page/devices/device/325/operation_pu?' + querystring.stringify({
                page:            '1',
                page325:         '1',                     // 325がシャッター関係・・かも。
                nodeId:          device.nodeId,           // このあたり必ずしも操作する
                eoj:             device.eoj,              // 機器と一致してなくとも良い
                type:            device.type,             // みたいだが念のため。
                track:           '325',
                acceptId:        '83038',                 // この値はなんでもいいみたい。
                request_by_form: '1'
            }),
            port:    PORT,
            method:  'GET',
            headers: headers
        });
        // 読み出したhtmlに下記のような感じでトークンが書かれているのでそれを抜き出す。
        // <!-- コントロールID -->
        // <span class="setting_value" style="display:none;">76856</span>
        // <!-- トークン -->
        // <span class="setting_value" style="display:none;">53529</span>
        // <!-- 呼び出し元URL -->
        // <span class="setting_value" style="display:none;"></span>
        // <!-- 機器種別 -->
        // <span class="setting_value" style="display:none;">0x0e</span>
        // <!-- 機器名称 -->
        // <span class="setting_value" style="display:none;"></span>
        // <!-- 機器情報 -->
        // <span class="setting_value" style="display:none;"></span>
        // <!-- 遷移元情報 -->
        // <span class="setting_value" style="display:none;"></span>
        const dom = new JSDOM(response.body);
        const setting_value = dom.window.document.querySelectorAll('.setting_value');
        // 得たトークンを使ってシャッターを操作する。
        // POSTするデータは
        // a) 頭に'data='を付ける。
        // b) objSendDataプロパティの中身はJSON.stringifyが必要な素敵仕様。
        debug(`aiseg2.doShutter: ${device.nodeId} ${device.eoj} ${device.type} ${op}`);
        await this.digestRequest.requestAsync({
            host:    host,
            path:    '/action/devices/device/325/operation',
            port:    PORT,
            method:  'POST',
            body:    'data=' + JSON.stringify({
                objSendData:  JSON.stringify({
                    nodeId:   device.nodeId,
                    eoj:      device.eoj,
                    type:     device.type,
                    device: {
                        open: op
                    }
                }),
                token: setting_value[1].textContent
            }),
            headers: headers
        });
        return `shutter ${device.name} operation ${op} success.`;
    } catch (err) {
        throw new Error(`shutter ${device.name} operation failed.`);
    }
};

// 空気環境（温度、湿度）を取得する
aiseg2.prototype.getAirEnvironment = async function(address) {
    let rooms = [];
    try {
        let host = addr2host(address);

        for (let page = 1; page <= 2; page++) {
            let response = await this.digestRequest.requestAsync({
                host:    host,
                path:    '/page/airenvironment/43?' + querystring.stringify({
                    page:  page
                }),
                port:    PORT,
                method:  'GET',
                headers: headers
            });

            const dom = new JSDOM(response.body);

            const area = dom.window.document.getElementById('area');
            const base = area.getElementsByClassName('base');
            for (let i = 0; i < base.length; i++) {
                if (base[i].innerHTML == '') {
                    continue;
                }
                let room = {};
                room.name = parseAisegName(base[i].getElementsByClassName('txt_name'));
                room.temp = parseAisegAirEnvironment(base[i].getElementsByClassName('num_ond'));
                room.humi = parseAisegAirEnvironment(base[i].getElementsByClassName('num_shitudo'));
                rooms.push(room);
            }
        }
    } catch (err) {
        throw new Error(`getAirEnvironment operation failed.`);
    }
    return rooms;
};

module.exports = aiseg2;
