// 假設這個 JS 檔案是在 HTML 中被載入的，並且以下元素已存在：
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const scoreDisplay = document.getElementById("score-display"); // 用來顯示分數的元素
const messageBox = document.getElementById("message-box");   // 用來顯示訊息的元素 (如勝利)

// 遊戲狀態變數
let score = 0;
const MAX_SCORE = 10;
let target = { x: 0, y: 0, radius: 30, visible: false };
// 檢查碰撞的關鍵點索引：9: 左手腕, 10: 右手腕, 15: 左腳踝, 16: 右腳踝
const collisionKeypoints = [9, 10, 15, 16]; 

// 用來儲存穩定頭部資訊的物件
let stableHead = { x: 0, y: 0, scale: 220 };
let prevState = { eyesOpen: true, mouthOpen: false, _lastLowerLipY: null, _lastLowerLipFrame: 0 };


// 設定與資源
// 這裡保留您希望使用的四張頭部圖片
const eyeMouthImgs = {
    openEyeOpenMouth: new Image(),
    openEyeCloseMouth: new Image(),
    closeEyeOpenMouth: new Image(),
    closeEyeCloseMouth: new Image()
};
// 假設這些是您要保留的帶有背景的頭部圖片
eyeMouthImgs.openEyeOpenMouth.src = "https://i.postimg.cc/RhcMz7xL/1.png";
eyeMouthImgs.openEyeCloseMouth.src = "https://i.postimg.cc/wMh6dXYm/3.png";
eyeMouthImgs.closeEyeOpenMouth.src = "https://i.postimg.cc/kGxndQPW/2.png";
eyeMouthImgs.closeEyeCloseMouth.src = "https://i.postimg.cc/x8K0SvVH/4.png";

// ---- camera setup ----
async function setupCamera() {
    const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 640, height: 480 },
        audio: false
    });
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    await new Promise(resolve => (video.onloadedmetadata = resolve));
    return video;
}

// ------------------------------------
// 遊戲輔助函式
// ------------------------------------

/**
 * 計算兩點間距離
 */
function dist(a, b) { 
    const dx = a.x - b.x; 
    const dy = a.y - b.y; 
    return Math.sqrt(dx * dx + dy * dy); 
}

/**
 * 重新生成目標圓點的位置和大小
 * @param {HTMLCanvasElement} canvas 
 * @param {object} headState - 包含 scale 屬性
 */
function updateTargetPosition(canvas, headState) {
    // 確保遊戲是在進行中 (分數未滿)
    if (score >= MAX_SCORE) return;
    
    // 目標大小與頭部大小保持一定的比例
    const minRadius = 25;
    const maxRadius = 50;
    // 根據偵測到的頭部大小動態調整目標半徑
    const currentScale = headState.scale || stableHead.scale; // 使用傳入或全域的 stableHead
    const targetRadius = Math.max(minRadius, Math.min(maxRadius, currentScale * 0.15));
    target.radius = targetRadius;

    // 確保目標圓點完全在畫布內
    target.x = Math.floor(Math.random() * (canvas.width - targetRadius * 2)) + targetRadius;
    target.y = Math.floor(Math.random() * (canvas.height - targetRadius * 2)) + targetRadius;
    target.visible = true;
}

/**
 * 處理遊戲重設和重新開始
 * 為了讓 HTML onclick 能夠找到，必須是全域函式。
 */
window.restartGame = function() {
    score = 0; // 重設分數
    displayScore(score, MAX_SCORE);
    
    // 隱藏訊息框並清除內容
    if (messageBox) {
        messageBox.classList.add('hidden');
        messageBox.innerHTML = '';
    }
    
    // 重新生成目標，啟動遊戲循環
    const currentHeadState = stableHead.scale ? stableHead : { scale: 220 };
    updateTargetPosition(canvas, currentHeadState);
    
    showMessageBox('遊戲重新開始！', 'bg-green-600', 1000); // 短暫提示
    
    // ⭐ 關鍵修正：重新啟動偵測迴圈 ⭐
    if (score < MAX_SCORE && window._isDetectRunning === false && window._detectionLoop) {
        window._isDetectRunning = true;
        window._detectionLoop(); // 重新啟動 requestAnimationFrame 迴圈
    }
}


/**
 * 繪製目標圓點
 * @param {CanvasRenderingContext2D} ctx 
 * @param {object} target 
 */
function drawTarget(ctx, target) {
    if (!target.visible) return;

    ctx.save();
    // 鏡像轉換後繪製，因此 filter 必須在 save/restore 內部
    ctx.filter = 'drop-shadow(0 0 8px rgba(255, 0, 0, 0.8))';

    // 圓點外圍
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 69, 0, 0.7)"; // 橘紅色
    ctx.fill();

    ctx.filter = 'none';

    // 圓點中心
    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = "red";
    ctx.fill();

    // 繪製提示文字
    ctx.fillStyle = 'white';
    ctx.font = `bold ${target.radius * 0.45}px 'Noto Sans TC', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    // 因為畫布是鏡像的，文字也必須鏡像回來才能正常顯示
    ctx.scale(-1, 1);
    ctx.fillText('碰我', -target.x, target.y);
    ctx.restore();
}

/**
 * 檢查關鍵點是否與目標圓點碰撞
 */
function checkCollision(keypoints, target, collisionKeypoints) {
    if (!target.visible) return false;

    for (const index of collisionKeypoints) {
        const kp = keypoints[index];
        // 確保關鍵點分數夠高
        if (kp && kp.score > 0.5) { 
            const dx = kp.x - target.x;
            const dy = kp.y - target.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            // 偵測距離小於目標半徑
            if (distance < target.radius) {
                return true;
            }
        }
    }
    return false;
}

/**
 * 顯示分數
 */
function displayScore(score, maxScore) {
    if (scoreDisplay) {
        scoreDisplay.textContent = `分數: ${score}/${maxScore}`;
    }
}

/**
 * 顯示遊戲訊息框 (Modal 樣式)
 */
function showMessageBox(messageHtml, bgColorClass = 'bg-gray-700', duration = 0) {
    if (messageBox) {
        // 使用 innerHTML 加上內部 div 容器來實現樣式和居中
        messageBox.innerHTML = `
            <div class="p-8 ${bgColorClass} text-white rounded-xl shadow-2xl max-w-lg mx-4 text-center">
                ${messageHtml}
            </div>
        `; 
        
        // messageBox 本身現在作為全螢幕遮罩
        messageBox.classList.remove('hidden');
        
        if (duration > 0) {
            setTimeout(() => {
                messageBox.classList.add('hidden');
            }, duration);
        }
    } else {
        console.log(`[Message] ${messageHtml.replace(/<[^>]*>?/gm, '')}`); // 如果沒有 UI 元素，則輸出到控制台
    }
}


// ---- 主程式 (整合遊戲邏輯) ----
window._isDetectRunning = false; // 追蹤偵測循環狀態
window._detectionLoop = null; // 儲存偵測迴圈的引用

async function runPoseDetection() {
    // 確保所有資源載入
    if (typeof poseDetection === 'undefined' || typeof tf === 'undefined') {
        console.error("TensorFlow and Pose Detection libraries must be loaded first.");
        showMessageBox('錯誤：請確認 HTML 已載入 TensorFlow 和 Pose Detection 函式庫。', 'bg-red-700');
        return;
    }

    await tf.setBackend('webgl');
    await tf.ready();
    
    const detector = await poseDetection.createDetector(
        poseDetection.SupportedModels.MoveNet,
        { 
            modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
            modelConfig: {
                enableSmoothing: true // 開啟平滑，減少抖動
            }
        }
    );

    try {
        await setupCamera();
        await video.play();
    } catch(e) {
        showMessageBox(`錯誤：無法啟動視訊偵測。請檢查攝影機權限。(${e.name})`, 'bg-red-700', 5000);
        return;
    }
  
    // 初始化畫布尺寸和鏡像轉換
    canvas.width = video.videoWidth || video.width;
    canvas.height = video.videoHeight || video.height;
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
    
    // 遊戲初始化
    score = 0;
    displayScore(score, MAX_SCORE);

    // 初始化 stableHead 於畫面中央
    stableHead.x = canvas.width / 2;
    stableHead.y = canvas.height / 2;

    let frameCount = 0;
    // 初始目標位置
    updateTargetPosition(canvas, stableHead); 

    const tmpCanvas = document.createElement('canvas');
    const tctx = tmpCanvas.getContext('2d');
    
    window._isDetectRunning = true; // 設置狀態為運行中

    async function detect() {
        if (window._isDetectRunning === false || score >= MAX_SCORE) {
             // 遊戲結束或已停止，不再進行偵測
            window._isDetectRunning = false;
            if (score >= MAX_SCORE) {
                // 清除畫布並繪製最後的目標圓點 (如果需要)
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.restore();
                drawTarget(ctx, target);
            }
            return;
        }

        requestAnimationFrame(detect);


        if (frameCount % 2 === 0) {
            const poses = await detector.estimatePoses(video);

            // 清空畫布前，記得先將上下文重設回未鏡像的狀態
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore(); // 恢復鏡像狀態

            poses.forEach(pose => {
                // 1. 估計嘴唇 Y 座標
                const lowerLipInterval = 4;
                let lowerLipY = null;
                if (frameCount - prevState._lastLowerLipFrame >= lowerLipInterval) {
                    lowerLipY = estimateLowerLipYFromFrame(pose.keypoints, video, tctx, tmpCanvas, {
                        targetWidth: 140, redThreshold: 18, minMaskPixels: 20
                    });
                    prevState._lastLowerLipFrame = frameCount;
                    if (lowerLipY !== null) prevState._lastLowerLipY = lowerLipY;
                } else {
                    lowerLipY = prevState._lastLowerLipY;
                }

                // 2. 計算頭部狀態
                calculateHeadState(pose.keypoints, stableHead, prevState, lowerLipY); 
                
                // 3. 繪圖：從底層到頂層
                
                // a. 繪製頭部圖片 (圖層最底)
                drawHeadImage(stableHead, prevState);
                
                // b. 繪製身體部位 (圖層中間 - 包含軀幹和四肢)
                drawBodyParts(pose.keypoints, stableHead.scale); 
                
                // c. 繪製目標圓點
                drawTarget(ctx, target);

                // d. 繪製骨架點 (圖層最上)
                drawSkeleton(pose.keypoints, stableHead.scale); 
                
                // 4. 遊戲邏輯與碰撞偵測
                if (target.visible && checkCollision(pose.keypoints, target, collisionKeypoints)) {
                    score++;
                    displayScore(score, MAX_SCORE);
                    
                    if (score >= MAX_SCORE) {
                        // 遊戲勝利
                        target.visible = false;
                        window._isDetectRunning = false; // 停止偵測循環
                        
                        // 顯示持續的勝利訊息和重新開始按鈕
                        const victoryHtml = `
                            <p class="text-3xl font-bold mb-4">你成功了！恭喜完成挑戰！</p>
                            <button onclick="restartGame()" 
                                    class="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold py-2 px-4 rounded-full shadow-lg transition duration-150 transform hover:scale-105">
                                重新開始
                            </button>
                        `;
                        showMessageBox(victoryHtml, 'bg-purple-700');
                        
                        return; // 停止當前幀的後續處理
                        
                    } else {
                        // 碰撞成功，更新目標位置
                        updateTargetPosition(canvas, stableHead);
                    }
                }
            });
        }

        frameCount++;
    }
    
    // ⭐ 關鍵修正：將偵測迴圈的引用儲存到全域變數中 ⭐
    window._detectionLoop = detect; 
    
    detect();
}

// ------------------------------------
// 繪圖函式 (無變動)
// ------------------------------------
function drawHeadImage(stableHead, prevState) {
    let img;
    if (prevState.eyesOpen && prevState.mouthOpen) img = eyeMouthImgs.openEyeOpenMouth;
    else if (prevState.eyesOpen && !prevState.mouthOpen) img = eyeMouthImgs.openEyeCloseMouth;
    else if (!prevState.eyesOpen && prevState.mouthOpen) img = eyeMouthImgs.closeEyeOpenMouth;
    else img = eyeMouthImgs.closeEyeCloseMouth;

    if (img && img.complete) {
        const imgWidth = stableHead.scale;
        const imgHeight = stableHead.scale;
        const offsetY = 0; 

        ctx.drawImage(img, 
            stableHead.x - imgWidth / 2, 
            stableHead.y - imgHeight / 2 + offsetY, 
            imgWidth, 
            imgHeight
        );
    }
}

function drawSegment(p1, p2, color, thickness) {
    if (p1.score < 0.3 || p2.score < 0.3) return;

    const segmentLength = dist(p1, p2);
    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);

    ctx.save();
    ctx.translate(p1.x, p1.y);
    ctx.rotate(angle);

    // 繪製膠囊形狀
    ctx.beginPath();
    ctx.arc(0, 0, thickness / 2, Math.PI / 2, Math.PI * 3 / 2); // 半圓在 p1 端
    ctx.lineTo(segmentLength, -thickness / 2);
    ctx.arc(segmentLength, 0, thickness / 2, Math.PI * 3 / 2, Math.PI / 2); // 半圓在 p2 端
    ctx.lineTo(0, thickness / 2);
    ctx.closePath();

    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}


function drawBodyParts(keypoints, headScale) {
    // 根據頭部大小調整粗細
    const defaultThickness = Math.max(15, Math.min(80, headScale / 8)); 

    const leftShoulder = keypoints[5];
    const rightShoulder = keypoints[6];
    const leftHip = keypoints[11];
    const rightHip = keypoints[12];
    
    // 繪製四點多邊形軀幹
    if (leftShoulder.score > 0.3 && rightShoulder.score > 0.3 && 
        leftHip.score > 0.3 && rightHip.score > 0.3) {
        
        ctx.beginPath();
        ctx.moveTo(leftShoulder.x, leftShoulder.y);  
        ctx.lineTo(rightShoulder.x, rightShoulder.y); 
        ctx.lineTo(rightHip.x, rightHip.y);          
        ctx.lineTo(leftHip.x, leftHip.y);            
        ctx.closePath();
        
        ctx.fillStyle = "rgba(255, 140, 0, 0.9)"; // 橘色，90% 不透明度
        ctx.fill();
        
        ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // 繪製四肢
    drawSegment(keypoints[6], keypoints[8], "#8A2BE2", defaultThickness);       
    drawSegment(keypoints[8], keypoints[10], "#4169E1", defaultThickness * 0.8);  
    drawSegment(keypoints[5], keypoints[7], "#8A2BE2", defaultThickness);       
    drawSegment(keypoints[7], keypoints[9], "#4169E1", defaultThickness * 0.8);  
    drawSegment(keypoints[12], keypoints[14], "#20B2AA", defaultThickness * 1.1); 
    drawSegment(keypoints[14], keypoints[16], "#008080", defaultThickness * 1.0); 
    drawSegment(keypoints[11], keypoints[13], "#20B2AA", defaultThickness * 1.1); 
    drawSegment(keypoints[13], keypoints[15], "#008080", defaultThickness * 1.0); 
}

function drawSkeleton(keypoints, headScale = 220) {
    
    keypoints.forEach(kp => {
        if (kp.score > 0.3) {
            const part = getBodyPart(kp, headScale);
            if (part) {
                const radius = Math.round(part.radius * 0.7); 
                ctx.beginPath();
                ctx.arc(kp.x, kp.y, radius, 0, Math.PI * 2);
                ctx.fillStyle = part.color; 
                ctx.fill();
                
                if (kp.part === 'nose') {
                    ctx.strokeStyle = '#FFFFFF';
                    ctx.lineWidth = 4;
                    ctx.stroke();
                }
            }
        }
    });
}

function getBodyPart(keypoint, headScale = 220) {
    const scaleFactor = headScale / 220;
    switch (keypoint.part) {
        case "nose": return { color: "#FFD740", radius: Math.round(30 * scaleFactor) };
        case "leftShoulder": case "rightShoulder":
        case "leftElbow": case "rightElbow":
        case "leftWrist": case "rightWrist": return { color: "#FF5252", radius: Math.round(18 * scaleFactor) };
        case "leftHip": case "rightHip": return { color: "#64DD17", radius: Math.round(24 * scaleFactor) };
        case "leftKnee": case "rightKnee": return { color: "#40C4FF", radius: Math.round(28 * scaleFactor) };
        case "leftAnkle": case "rightAnkle": return { color: "#40C4FF", radius: Math.round(28 * scaleFactor) };
        default: return null;
    }
}

// ------------------------------------
// 姿勢偵測與狀態計算 (無變動)
// ------------------------------------
function calculateHeadState(keypoints, stableHead, prevState, lowerLipYFromROI) {
    const nose = keypoints[0];
    const leftEye = keypoints[1];
    const rightEye = keypoints[2];
    const leftEar = keypoints[3];
    const rightEar = keypoints[4];
    const leftShoulder = keypoints[5];
    const rightShoulder = keypoints[6];
    const leftMouth = keypoints[9];
    const rightMouth = keypoints[10];

    if (nose.score < 0.3) return;

    // 1. 平滑頭位置
    stableHead.x += (nose.x - stableHead.x) * 0.2;
    stableHead.y += (nose.y - stableHead.y) * 0.2;

    // 2. 眼睛狀態
    const eyesOpen = leftEye.score > 0.5 && rightEye.score > 0.5;
    prevState.eyesOpen = eyesOpen;

    // 3. 計算 headSize
    let headSize = 220;
    const shoulderAvailable = leftShoulder.score > 0.3 && rightShoulder.score > 0.3;
    const eyeAvailable = leftEye.score > 0.3 && rightEye.score > 0.3;
    const earAvailable = leftEar.score > 0.3 && rightEar.score > 0.3;
    if (shoulderAvailable) {
        headSize = dist(leftShoulder, rightShoulder) * 2.0;
    } else if (eyeAvailable) {
        headSize = dist(leftEye, rightEye) * 6.5;
    } else if (earAvailable) {
        headSize = dist(leftEar, rightEar) * 2.2;
    }
    const MIN_HEAD = 140;
    const MAX_HEAD = Math.min(canvas.width, canvas.height) * 1.1;
    headSize = Math.max(MIN_HEAD, Math.min(MAX_HEAD, headSize));
    stableHead.scale += (headSize - stableHead.scale) * 0.15;

    // 4. 嘴巴偵測
    if (prevState._mouthOpenCounter === undefined) prevState._mouthOpenCounter = 0;
    if (prevState._mouthCloseCounter === undefined) prevState._mouthCloseCounter = 0;
    if (prevState._smoothedNormalized === undefined) prevState._smoothedNormalized = 0;
    if (prevState._baselineSum === undefined) prevState._baselineSum = 0;
    if (prevState._baselineFrames === undefined) prevState._baselineFrames = 0;
    if (prevState._baselineAvg === undefined) prevState._baselineAvg = 0;

    let mouthOpen = prevState.mouthOpen;

    let mouthIndicatorY = null;
    if (typeof lowerLipYFromROI === 'number') {
        mouthIndicatorY = lowerLipYFromROI;
    } else if (leftMouth && rightMouth && leftMouth.score > 0.3 && rightMouth.score > 0.3) {
        mouthIndicatorY = (leftMouth.y + rightMouth.y) / 2;
    }

    if (mouthIndicatorY !== null) {
        const normalized = (mouthIndicatorY - nose.y) / stableHead.scale;

        const BASELINE_FRAMES = 30;
        if (prevState._baselineFrames < BASELINE_FRAMES) {
            prevState._baselineSum += normalized;
            prevState._baselineFrames++;
            prevState._baselineAvg = prevState._baselineSum / prevState._baselineFrames;
        }

        if (!prevState._smoothedNormalized && prevState._smoothedNormalized !== 0) prevState._smoothedNormalized = normalized;
        prevState._smoothedNormalized += (normalized - prevState._smoothedNormalized) * 0.12;
        const smoothed = prevState._smoothedNormalized;

        const deltaOpen = 0.06;
        const deltaClose = 0.04;
        const openThreshold = prevState._baselineAvg + deltaOpen;
        const closeThreshold = prevState._baselineAvg + deltaClose;
        const requireFramesOpen = 3;
        const requireFramesClose = 3;

        if (smoothed > openThreshold) {
            prevState._mouthOpenCounter++;
            prevState._mouthCloseCounter = 0;
            if (prevState._mouthOpenCounter >= requireFramesOpen) mouthOpen = true;
        } else if (smoothed < closeThreshold) {
            prevState._mouthCloseCounter++;
            prevState._mouthOpenCounter = 0;
            if (prevState._mouthCloseCounter >= requireFramesClose) mouthOpen = false;
        } else {
            prevState._mouthOpenCounter = 0;
            prevState._mouthCloseCounter = 0;
            mouthOpen = prevState.mouthOpen;
        }
        
        if (prevState._baselineFrames >= BASELINE_FRAMES) {
            prevState._baselineAvg += (normalized - prevState._baselineAvg) * 0.002;
        }
    } else {
        mouthOpen = prevState.mouthOpen;
    }
    prevState.mouthOpen = mouthOpen;
}

// ---- 無模型下估計下嘴唇的函式（保持不變） ----
function estimateLowerLipYFromFrame(keypoints, videoEl, tctx, tmpCanvas, opts = {}) {
    const nose = keypoints[0];
    const leftShoulder = keypoints[5];
    const rightShoulder = keypoints[6];
    const leftEye = keypoints[1];
    const rightEye = keypoints[2];
    const leftEar = keypoints[3];
    const rightEar = keypoints[4];

    if (!nose || nose.score < 0.3) return null;

    const targetWidth = opts.targetWidth || 140;
    const redThreshold = opts.redThreshold || 18;
    const minMaskPixels = opts.minMaskPixels || 20;
    const belowNoseRatioMin = opts.belowNoseRatioMin || 0.08;
    const belowNoseRatioMax = opts.belowNoseRatioMax || 0.65;

    // 推估 face width
    let faceW;
    if (leftShoulder && rightShoulder && leftShoulder.score > 0.3 && rightShoulder.score > 0.3) {
        faceW = dist(leftShoulder, rightShoulder) * 1.6;
    } else if (leftEye && rightEye && leftEye.score > 0.3 && rightEye.score > 0.3) {
        faceW = dist(leftEye, rightEye) * 6.0;
    } else if (leftEar && rightEar && leftEar.score > 0.3 && rightEar.score > 0.3) {
        faceW = dist(leftEar, rightEar) * 1.2;
    } else {
        faceW = opts.fallbackFaceW || 220;
    }
    const faceH = faceW * 1.15;

    // ROI in canvas coords
    const cx = nose.x, cy = nose.y;
    let sx = Math.round(cx - faceW * 0.5);
    let sy = Math.round(cy - faceH * 0.35);
    let sw = Math.round(faceW);
    let sh = Math.round(faceH);

    const canvasW = videoEl.videoWidth || videoEl.width;
    const canvasH = videoEl.videoHeight || videoEl.height;
    if (sx < 0) { sw += sx; sx = 0; }
    if (sy < 0) { sh += sy; sy = 0; }
    if (sx + sw > canvasW) sw = canvasW - sx;
    if (sy + sh > canvasH) sh = canvasH - sy;
    if (sw <= 8 || sh <= 8) return null;

    // downscale to targetWidth
    const scale = targetWidth / sw;
    const dw = Math.max(10, Math.round(sw * scale));
    const dh = Math.max(10, Math.round(sh * scale));

    // resize tmpCanvas and draw ROI
    tmpCanvas.width = dw;
    tmpCanvas.height = dh;
    try {
        tctx.save();
        tctx.setTransform(1, 0, 0, 1, 0, 0); // 確保在 tmpCanvas 上是正常的繪製
        tctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, dw, dh);
        tctx.restore();
    } catch (e) {
        return null;
    }

    const img = tctx.getImageData(0, 0, dw, dh);
    const data = img.data;

    // row sums mask
    const rowSums = new Uint16Array(dh);
    let totalMask = 0;
    for (let y = 0; y < dh; y++) {
        let rowCount = 0;
        const rowOff = y * dw * 4;
        for (let x = 0; x < dw; x++) {
            const i = rowOff + x * 4;
            const R = data[i], G = data[i + 1], B = data[i + 2];
            const lum = 0.299 * R + 0.587 * G + 0.114 * B;
            if (lum < 18 || lum > 245) continue; // 過暗或過亮忽略
            const score = R - ((G + B) / 2);
            if (score > redThreshold) rowCount++;
        }
        rowSums[y] = rowCount;
        totalMask += rowCount;
    }
    if (totalMask < minMaskPixels) return null;

    // smooth row sums (moving average)
    const smooth = new Float32Array(dh);
    const k = 3;
    for (let y = 0; y < dh; y++) {
        let s = 0, c = 0;
        const y0 = Math.max(0, y - k);
        const y1 = Math.min(dh - 1, y + k);
        for (let yy = y0; yy <= y1; yy++) { s += rowSums[yy]; c++; }
        smooth[y] = s / c;
    }

    const noseRelY = Math.round((nose.y - sy) * scale);
    const minRow = Math.max(0, Math.floor(noseRelY + dh * belowNoseRatioMin));
    const maxRow = Math.min(dh - 1, Math.ceil(noseRelY + dh * belowNoseRatioMax));
    if (minRow > maxRow) return null;

    let bestRow = -1;
    let bestVal = -1;
    for (let y = minRow; y <= maxRow; y++) {
        if (smooth[y] > bestVal) { bestVal = smooth[y]; bestRow = y; }
    }
    if (bestRow < 0 || bestVal <= 0) return null;

    // translate back to canvas coordinates
    const lowerLipY = sy + (bestRow / scale);
    return lowerLipY;
}

// 啟動
window.onload = function() {
    runPoseDetection().catch(e => {
        console.error('runPoseDetection error', e);
        // 檢查錯誤是否為攝影機權限相關，並給予提示
        const message = e.name === 'NotAllowedError' ? 
            '錯誤：攝影機權限被拒絕。請檢查瀏覽器和作業系統的權限設定。' : 
            `錯誤：無法啟動視訊偵測。(${e.name})`;
            
        showMessageBox(message, 'bg-red-700', 5000);
    });
};