// 假設這個 JS 檔案是在 HTML 中被載入的，並且以下元素已存在：
const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");
const scoreDisplay = document.getElementById("score-display");
const timerDisplay = document.getElementById("timer-display");
const messageBox = document.getElementById("message-box");
const cameraToggleBtn = document.getElementById("camera-toggle-btn"); // 按鈕元素
const cameraStatus = document.getElementById("camera-status");     // 狀態元素

// 遊戲狀態變數
let score = 0;
const MAX_SCORE = 10;
let target = { x: 0, y: 0, radius: 30, visible: false };
const collisionKeypoints = [9, 10, 15, 16]; 

// 計時器相關變數
let gameTimer = null; 
const gameTimeLimit = 15; 
let startTime = 0; 

// 攝影機和偵測器狀態
let isCameraActive = false; // 追蹤攝影機是否運行
let detector = null;        // 儲存 PoseNet 偵測器

let stableHead = { x: 0, y: 0, scale: 220 };
let prevState = { eyesOpen: true, mouthOpen: false, _lastLowerLipY: null, _lastLowerLipFrame: 0 };


// 設定與資源 (保持不變)
const eyeMouthImgs = {
    openEyeOpenMouth: new Image(),
    openEyeCloseMouth: new Image(),
    closeEyeOpenMouth: new Image(),
    closeEyeCloseMouth: new Image()
};
eyeMouthImgs.openEyeOpenMouth.src = "https://i.postimg.cc/RhcMz7xL/1.png";
eyeMouthImgs.openEyeCloseMouth.src = "https://i.postimg.cc/wMh6dXYm/3.png";
eyeMouthImgs.closeEyeOpenMouth.src = "https://i.postimg.cc/kGxndQPW/2.png";
eyeMouthImgs.closeEyeCloseMouth.src = "https://i.postimg.cc/x8K0SvVH/4.png";

// ---- camera setup (保持不變) ----
async function setupCamera() {
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }

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
// 鏡頭控制函式 (保持不變)
// ------------------------------------

window.toggleCamera = async function() {
    if (isCameraActive) {
        stopDetectionAndCamera();
    } else {
        await startDetectionAndCamera();
    }
};

async function startDetectionAndCamera() {
    try {
        if (!detector) {
            showMessageBox('正在載入模型，請稍候...', 'bg-blue-600', 0);
            await runPoseDetection(); // 初始化偵測器和畫布
            messageBox.classList.add('hidden'); 
        }
        
        await setupCamera();
        await video.play();

        isCameraActive = true;
        
        cameraToggleBtn.textContent = '停止鏡頭';
        cameraToggleBtn.classList.remove('bg-red-500', 'hover:bg-red-600');
        cameraToggleBtn.classList.add('bg-green-500', 'hover:bg-green-600');
        cameraStatus.innerHTML = '<span class="text-green-400">攝影機狀態：運行中 ✅</span>';

        window.restartGame();
        
    } catch (e) {
        const message = e.name === 'NotAllowedError' ? 
            '錯誤：攝影機權限被拒絕。請檢查權限設定。' : 
            `錯誤：無法啟動鏡頭。(${e.name})`;
        showMessageBox(message, 'bg-red-700', 5000);
        console.error('Camera/Detection start error', e);
        stopDetectionAndCamera(); 
    }
}

function stopDetectionAndCamera() {
    clearInterval(gameTimer);
    gameTimer = null;
    window._isDetectRunning = false;
    target.visible = false;
    
    if (video.srcObject) {
        video.srcObject.getTracks().forEach(track => track.stop());
        video.srcObject = null;
    }
    
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
    
    showMessageBox('攝影機已停止。請點擊「啟動鏡頭」按鈕開始遊戲。', 'bg-gray-700');

    isCameraActive = false;
    cameraToggleBtn.textContent = '啟動鏡頭';
    cameraToggleBtn.classList.remove('bg-green-500', 'hover:bg-green-600');
    cameraToggleBtn.classList.add('bg-red-500', 'hover:bg-red-600');
    cameraStatus.innerHTML = '<span class="text-red-400">攝影機狀態：未啟動 ❌</span>';
    updateTimerDisplay(gameTimeLimit);
    displayScore(0, MAX_SCORE);
}

// ------------------------------------
// 遊戲輔助函式 (保持不變)
// ------------------------------------

function dist(a, b) { 
    const dx = a.x - b.x; 
    const dy = a.y - b.y; 
    return Math.sqrt(dx * dx + dy * dy); 
}

/**
 * 重新生成目標圓點的位置和大小
 */
function updateTargetPosition(canvas, headState) {
    if (score >= MAX_SCORE) return; 
    
    const minRadius = 25;
    const maxRadius = 50;
    const currentScale = headState.scale || stableHead.scale;
    const targetRadius = Math.max(minRadius, Math.min(maxRadius, currentScale * 0.15));
    target.radius = targetRadius;

    target.x = Math.floor(Math.random() * (canvas.width - targetRadius * 2)) + targetRadius;
    target.y = Math.floor(Math.random() * (canvas.height - targetRadius * 2)) + targetRadius;
    
    target.visible = true; 
}

/**
 * 處理遊戲結束 (保持不變)
 */
function handleGameOver(isSuccess) {
    clearInterval(gameTimer);
    gameTimer = null;
    window._isDetectRunning = false;
    
    target.visible = false; 
    
    const buttonHtml = `
        <button onclick="window.restartGame()" 
                class="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-bold py-2 px-4 rounded-full shadow-lg transition duration-150 transform hover:scale-105 mt-4">
            重新開始
        </button>
    `;

    if (isSuccess) {
        const victoryHtml = `
            <p class="text-3xl font-bold mb-4">🏆 挑戰成功！🎉</p>
            <p class="text-xl">你成功在 ${((performance.now() - startTime) / 1000).toFixed(1)} 秒內拿到 ${MAX_SCORE} 分！</p>
            ${buttonHtml}
        `;
        showMessageBox(victoryHtml, 'bg-green-700');
    } else {
        const failureHtml = `
            <p class="text-3xl font-bold mb-4">⏰ 時間到！挑戰失敗 😭</p>
            <p class="text-xl">你的分數是 ${score}/${MAX_SCORE}。下次再試試！</p>
            ${buttonHtml}
        `;
        showMessageBox(failureHtml, 'bg-red-700');
    }
}

/**
 * 處理遊戲重設和重新開始 (保持不變)
 */
window.restartGame = function() {
    if (!isCameraActive) {
        showMessageBox('請先點擊「啟動鏡頭」按鈕開始遊戲！', 'bg-yellow-600', 3000);
        return;
    }
    
    score = 0; 
    displayScore(score, MAX_SCORE);
    
    clearInterval(gameTimer);
    updateTimerDisplay(gameTimeLimit);
    
    if (messageBox) {
        messageBox.classList.add('hidden');
    }
    
    const currentHeadState = stableHead.scale ? stableHead : { scale: 220 };
    updateTargetPosition(canvas, currentHeadState); 
    
    if (window._detectionLoop) {
        window._isDetectRunning = true; 
        
        startTime = performance.now();
        gameTimer = setInterval(() => {
            const elapsedTime = (performance.now() - startTime) / 1000;
            const remainingTime = Math.max(0, gameTimeLimit - elapsedTime);
            
            updateTimerDisplay(remainingTime);
            
            if (remainingTime <= 0) {
                clearInterval(gameTimer);
                gameTimer = null;
                if (score < MAX_SCORE) {
                    handleGameOver(false); 
                }
            }
        }, 100); 
        
        window._detectionLoop(); 
    }
}

/**
 * 繪製目標圓點 (保持不變)
 */
function drawTarget(ctx, target) {
    if (!target.visible) return;

    ctx.save();
    ctx.filter = 'drop-shadow(0 0 8px rgba(255, 0, 0, 0.8))';

    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255, 69, 0, 0.7)"; 
    ctx.fill();

    ctx.filter = 'none';

    ctx.beginPath();
    ctx.arc(target.x, target.y, target.radius * 0.7, 0, Math.PI * 2);
    ctx.fillStyle = "red";
    ctx.fill();

    ctx.fillStyle = 'white';
    ctx.font = `bold ${target.radius * 0.45}px 'Noto Sans TC', sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    ctx.scale(-1, 1);
    ctx.fillText('碰我', -target.x, target.y);
    ctx.restore();
}

function checkCollision(keypoints, target, collisionKeypoints) {
    if (!target.visible) return false;

    for (const index of collisionKeypoints) {
        const kp = keypoints[index];
        if (kp && kp.score > 0.5) { 
            const dx = kp.x - target.x;
            const dy = kp.y - target.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            if (distance < target.radius) {
                return true;
            }
        }
    }
    return false;
}

function displayScore(score, maxScore) {
    if (scoreDisplay) {
        scoreDisplay.textContent = `分數: ${score}/${maxScore}`;
    }
}

function updateTimerDisplay(seconds) {
    if (timerDisplay) {
        const formattedTime = seconds.toFixed(1);
        let colorClass = 'text-green-300';
        if (seconds <= 5) {
            colorClass = 'text-red-400 animate-pulse'; 
        } else if (seconds <= 10) {
            colorClass = 'text-yellow-300';
        }

        timerDisplay.innerHTML = `<span class="${colorClass} transition-colors duration-100">${formattedTime}</span> s`;
    }
}

function showMessageBox(messageHtml, bgColorClass = 'bg-gray-700', duration = 0) {
    if (messageBox) {
        messageBox.innerHTML = `
            <div class="p-8 ${bgColorClass} text-white rounded-xl shadow-2xl max-w-lg mx-4 text-center">
                ${messageHtml}
            </div>
        `; 
        
        messageBox.classList.remove('hidden');
        
        if (duration > 0) {
            setTimeout(() => {
                if (window._isDetectRunning && score < MAX_SCORE) {
                    messageBox.classList.add('hidden');
                }
            }, duration);
        }
    } else {
        console.log(`[Message] ${messageHtml.replace(/<[^>]*>?/gm, '')}`);
    }
}


// ---- 主程式 (偵測器初始化) ----
window._isDetectRunning = false; 
window._detectionLoop = null; 
window._lastPoseKeypoints = []; 

async function runPoseDetection() {
    if (!detector) {
        if (typeof poseDetection === 'undefined' || typeof tf === 'undefined') {
            throw new Error("TensorFlow and Pose Detection libraries must be loaded first.");
        }

        await tf.setBackend('webgl');
        await tf.ready();
        
        detector = await poseDetection.createDetector(
            poseDetection.SupportedModels.MoveNet,
            { 
                modelType: poseDetection.movenet.modelType.SINGLEPOSE_THUNDER,
                modelConfig: {
                    enableSmoothing: true
                }
            }
        );
        
        canvas.width = 640; 
        canvas.height = 480; 
        ctx.translate(canvas.width, 0);
        ctx.scale(-1, 1);
        
        stableHead.x = canvas.width / 2;
        stableHead.y = canvas.height / 2;
    }

    let frameCount = 0;
    const tmpCanvas = document.createElement('canvas');
    const tctx = tmpCanvas.getContext('2d');
    
    async function detect() {
        if (!isCameraActive) {
            requestAnimationFrame(detect);
            return; 
        }

        requestAnimationFrame(detect);

        if (frameCount % 2 === 0 && detector) {
            
            let poses = [];
            try {
                 poses = await detector.estimatePoses(video);
            } catch (e) {
                 console.warn("Pose detection error, stopping camera.", e);
                 stopDetectionAndCamera();
                 showMessageBox('偵測器發生錯誤，請重新啟動鏡頭。', 'bg-red-700');
                 return;
            }

            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.restore(); 

            // 原始位置已移除 drawTarget(ctx, target);
            
            poses.forEach(pose => {
                window._lastPoseKeypoints = pose.keypoints;

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

                calculateHeadState(pose.keypoints, stableHead, prevState, lowerLipY); 
                
                drawHeadImage(stableHead, prevState);
                // 【修改點：圓點圖層移至此處，確保在頭部圖片之上】
                drawTarget(ctx, target); 
                
                drawBodyParts(pose.keypoints, stableHead.scale); 
                drawSkeleton(pose.keypoints, stableHead.scale); 
                
                if (window._isDetectRunning && target.visible && checkCollision(pose.keypoints, target, collisionKeypoints)) {
                    score++;
                    displayScore(score, MAX_SCORE);
                    
                    if (score >= MAX_SCORE) {
                        handleGameOver(true);
                        return; 
                        
                    } else {
                        updateTargetPosition(canvas, stableHead);
                    }
                }
            });
        }

        frameCount++;
    }
    
    window._detectionLoop = detect; 
    
    detect();
}

// ... (以下為保持不變的函式 body)
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

    ctx.beginPath();
    ctx.arc(0, 0, thickness / 2, Math.PI / 2, Math.PI * 3 / 2); 
    ctx.lineTo(segmentLength, -thickness / 2);
    ctx.arc(segmentLength, 0, thickness / 2, Math.PI * 3 / 2, Math.PI / 2); 
    ctx.lineTo(0, thickness / 2);
    ctx.closePath();

    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
}


function drawBodyParts(keypoints, headScale) {
    const defaultThickness = Math.max(15, Math.min(80, headScale / 8)); 

    const leftShoulder = keypoints[5];
    const rightShoulder = keypoints[6];
    const leftHip = keypoints[11];
    const rightHip = keypoints[12];
    
    if (leftShoulder.score > 0.3 && rightShoulder.score > 0.3 && 
        leftHip.score > 0.3 && rightHip.score > 0.3) {
        
        ctx.beginPath();
        ctx.moveTo(leftShoulder.x, leftShoulder.y);  
        ctx.lineTo(rightShoulder.x, rightShoulder.y); 
        ctx.lineTo(rightHip.x, rightHip.y);          
        ctx.lineTo(leftHip.x, leftHip.y);            
        ctx.closePath();
        
        ctx.fillStyle = "rgba(255, 140, 0, 0.9)"; 
        ctx.fill();
        
        ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
        ctx.lineWidth = 2;
        ctx.stroke();
    }

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

    stableHead.x += (nose.x - stableHead.x) * 0.2;
    stableHead.y += (nose.y - stableHead.y) * 0.2;

    const eyesOpen = leftEye.score > 0.5 && rightEye.score > 0.5;
    prevState.eyesOpen = eyesOpen;

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

    const scale = targetWidth / sw;
    const dw = Math.max(10, Math.round(sw * scale));
    const dh = Math.max(10, Math.round(sh * scale));

    tmpCanvas.width = dw;
    tmpCanvas.height = dh;
    try {
        tctx.save();
        tctx.setTransform(1, 0, 0, 1, 0, 0); 
        tctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, dw, dh);
        tctx.restore();
    } catch (e) {
        return null;
    }

    const img = tctx.getImageData(0, 0, dw, dh);
    const data = img.data;

    const rowSums = new Uint16Array(dh);
    let totalMask = 0;
    for (let y = 0; y < dh; y++) {
        let rowCount = 0;
        const rowOff = y * dw * 4;
        for (let x = 0; x < dw; x++) {
            const i = rowOff + x * 4;
            const R = data[i], G = data[i + 1], B = data[i + 2];
            const lum = 0.299 * R + 0.587 * G + 0.114 * B;
            if (lum < 18 || lum > 245) continue; 
            const score = R - ((G + B) / 2);
            if (score > redThreshold) rowCount++;
        }
        rowSums[y] = rowCount;
        totalMask += rowCount;
    }
    if (totalMask < minMaskPixels) return null;

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

    const lowerLipY = sy + (bestRow / scale);
    return lowerLipY;
}

window.onload = function() {
    runPoseDetection().catch(e => {
        console.error('Initial model load error', e);
        showMessageBox('模型載入失敗，請檢查網路。', 'bg-red-700', 5000);
    });
    
    
};