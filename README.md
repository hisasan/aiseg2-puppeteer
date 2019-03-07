# aiseg2-puppeteer

ラズパイなどでパナソニック社製AiSEG2に接続した機器の制御などを行うモジュールです。今のところ下記の2つしかできません。

* シャッター制御
* 温度/湿度取得

## 使い方

下記のような感じで使用します。

### 初期化

ユーザ名とパスワードはAiSEG2にウェブブラウザでアクセスするときに入力するものを使用してください。

```JavaScript
const aiseg2_factory('aiseg2-puppeteer');
const acl = {
    username: 'username',
    password: 'password'
}
const aiseg2 = new aiseg2_factory(acl);
```

### シャッター制御

```JavaScript
// AiSEG2のアドレスを得る
// UPnPのマルチキャストを使って探してるので、それが届く範囲からしか見つけられない
const address = await aiseg2.discover();
// シャッター一覧を得る
const list    = await aiseg2.getShutter(address);
// こんな感じの配列が得られる
// list = [
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
// 上記で取得した配列の1要素を使ってシャッター指定
// 開閉は opList.open/close/stop が指定可
const resp = await aiseg2.doShutter(address, list['ガレージシャッター'], aiseg2.opList.open);
```

うちのAiSEG2には制御すべきシャッターが3つしかつながってないので、2ページ(5つ以上？)にわたるようなシャッターがある場合はうまくgetShutter()でとれないと思われます。

### 温度/湿度取得

AiSEG2の空気環境で閲覧できる温度/湿度が取得できます。

```JavaScript
// AiSEG2のアドレスを得る
const address = await aiseg2.discover();
// 空気環境温度/湿度を得る
const rooms   = await aiseg2.getAirEnvironment(address);
// こんな感じの配列が得られる
// rooms = [
//   {
//     name: 'リビング',
//     temp: '25.0',
//     humi: '40.0'
//   },
//   {
//     name: '屋外',
//     temp: '8.0',
//     humi: '60.0'
//   }
// ];
// 配列の各要素がそれぞれの空気環境で設定した部屋に対応している
```

## 使用環境
以下のような環境で使用しています。

|項目|内容|
|:----|:--------------------------------------|
|ホスト|Raspberry Pi 3B+ Raspbian Stretch Lite|
|AiSEG2バージョン|Ver.2.40Q-01動作確認済み|
|操作機器|三和シャッター社製シャッター + HEMS対応操作ユニット HEM-800 x 3系統|
||パナソニック社製エアコン(の温度センサ)|
||パナソニック社製温湿度センサー(屋外用) MKN7512F|
