// ----------------------------
//   pptxConverterWinax.js
//   ver.2.2.4
// ----------------------------


let ActiveXObject;
let winaxAvailable = true;
try {
    ActiveXObject = require('winax').Object;
} catch (e) {
    winaxAvailable = false;
}
const fs = require('fs');
const path = require('path');

function available() {
    return winaxAvailable;
}

// PPTXファイルを開いて、各スライドをPNG連番として出力する。
async function convertPPTXToPNG(pptxPath) {
    return new Promise((resolve, reject) => {
        if (!winaxAvailable) {
            reject(new Error('winax モジュールが利用できません。'));
            return;
        }
        try {
            // PPTXファイルのディレクトリとベース名を取得
            const pptDir = path.dirname(pptxPath);
            const pptBase = path.basename(pptxPath, path.extname(pptxPath));
            const outputFolder = path.join(pptDir, pptBase + '_pngconvert');

            // 出力フォルダが存在しなければ作成
            if (!fs.existsSync(outputFolder)) {
                fs.mkdirSync(outputFolder);
            }

            // PowerPointアプリケーションのCOMオブジェクトを生成（非表示で最小化）
            let pptApp;
            try {
                pptApp = new ActiveXObject("PowerPoint.Application");
            } catch (innerError) {
                // エラー発生時にメッセージを表示し、その後エラーとして処理する
                showMessage('PowerPoint is either not installed or not configured correctly. This feature requires that PowerPoint be installed.', 10000, 'alert');
                throw innerError;  // または適切にエラー処理を行う
            }

            // PPTXファイルを開く（ウィンドウ非表示）
            const pptPres = pptApp.Presentations.Open(pptxPath, false, false, false);
            // ページ設定からスライドのサイズを取得
            const pageSetup = pptPres.PageSetup;
            const slideWidth = pageSetup.SlideWidth;
            const slideHeight = pageSetup.SlideHeight;
            const actualAspect = slideWidth / slideHeight;
            const targetAspect = 16 / 9;
            let exportWidth, exportHeight;;
            
            // 16:9なら1080p、それ以外なら2倍の解像度で書き出し
            if (Math.abs(actualAspect - targetAspect) < 0.1) {
                exportWidth = 1920;
                exportHeight = 1080;
            } else {
                const scale = 2.0;
                exportWidth = Math.round(slideWidth * scale);
                exportHeight = Math.round(slideHeight * scale);
            }
            const slideCount = pptPres.Slides.Count;

            // 各スライドをPNGでエクスポート
            for (let i = 1; i <= slideCount; i++) {
                const slide = pptPres.Slides.Item(i);
                // 出力ファイルパス例："Slide_001.png"
                const outputFile = path.join(outputFolder, `Slide_${String(i).padStart(3, '0')}.png`);
                // Exportメソッドで指定解像度で出力
                slide.Export(outputFile, "PNG", exportWidth, exportHeight);
            }

            // PPTXファイルとアプリケーションを閉じる
            pptPres.Close();
            pptApp.Quit();

            resolve(outputFolder);
        } catch (error) {
            reject(error);
        }
    });
}

module.exports = { available, convertPPTXToPNG };
