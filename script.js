const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

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

// ---- camera setup (保持不變) ----
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

// ---- 主程式 (保持不變) ----
async function runPoseDetection() {
  const detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );

  await setupCamera();
  await video.play().catch(() => {});
  canvas.width = video.videoWidth || video.width;
  canvas.height = video.videoHeight || video.height;

  let frameCount = 0;
  let prevState = { eyesOpen: true, mouthOpen: false }; 
  let stableHead = { x: canvas.width / 2, y: canvas.height / 2, scale: 220 };
  
  prevState._lastLowerLipY = null;
  prevState._lastLowerLipFrame = 0;

  const tmpCanvas = document.createElement('canvas');
  const tctx = tmpCanvas.getContext('2d');

  async function detect() {
    requestAnimationFrame(detect);

    if (frameCount % 2 === 0) {
      const poses = await detector.estimatePoses(video);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

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
        
        // c. 繪製骨架點 (圖層最上)
        drawSkeleton(pose.keypoints, stableHead.scale); 
        
      });
    }

    frameCount++;
  }

  detect();
}

// ------------------------------------
// 繪製頭部圖片 (圖層最底)
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

// ------------------------------------
// 繪製身體部位函式 (使用四個點繪製多邊形軀幹)
// ------------------------------------

function dist(a, b) { 
  const dx = a.x - b.x; 
  const dy = a.y - b.y; 
  return Math.sqrt(dx * dx + dy * dy); 
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
  
  // ------------------------------------
  // *** 核心修改：繪製四點多邊形軀幹 ***
  // ------------------------------------
  if (leftShoulder.score > 0.3 && rightShoulder.score > 0.3 && 
      leftHip.score > 0.3 && rightHip.score > 0.3) {
      
    ctx.beginPath();
    // 依序連接四個關鍵點
    ctx.moveTo(leftShoulder.x, leftShoulder.y);  // 1. 左肩
    ctx.lineTo(rightShoulder.x, rightShoulder.y); // 2. 右肩
    ctx.lineTo(rightHip.x, rightHip.y);          // 3. 右髖
    ctx.lineTo(leftHip.x, leftHip.y);            // 4. 左髖
    ctx.closePath();
    
    // 讓軀幹的顏色略微透明，以便在頭部圖片下方有更好的融合效果
    ctx.fillStyle = "rgba(255, 140, 0, 0.9)"; // 橘色，90% 不透明度
    ctx.fill();
    
    // 選擇性：給軀幹加上一個外框
    ctx.strokeStyle = "rgba(0, 0, 0, 0.4)";
    ctx.lineWidth = 2;
    ctx.stroke();
  }


  // 右臂
  drawSegment(keypoints[6], keypoints[8], "#8A2BE2", defaultThickness);       // 右肩-右肘 (藍紫色)
  drawSegment(keypoints[8], keypoints[10], "#4169E1", defaultThickness * 0.8);  // 右肘-右手腕 (皇家藍)

  // 左臂
  drawSegment(keypoints[5], keypoints[7], "#8A2BE2", defaultThickness);       // 左肩-左肘 (藍紫色)
  drawSegment(keypoints[7], keypoints[9], "#4169E1", defaultThickness * 0.8);  // 左肘-左手腕 (皇家藍)

  // 右腿
  drawSegment(keypoints[12], keypoints[14], "#20B2AA", defaultThickness * 1.1); // 右髖-右膝 (淺海綠)
  drawSegment(keypoints[14], keypoints[16], "#008080", defaultThickness * 1.0); // 右膝-右腳踝 (青色)

  // 左腿
  drawSegment(keypoints[11], keypoints[13], "#20B2AA", defaultThickness * 1.1); // 左髖-左膝 (淺海綠)
  drawSegment(keypoints[13], keypoints[15], "#008080", defaultThickness * 1.0); // 左膝-左腳踝 (青色)
}


// ---- 繪製骨架 (保持不變) ----
function drawSkeleton(keypoints, headScale = 220) {
  // 保持不變，只繪製關節點 (圓點)
  
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
  // 保持骨架點的定義，用於 drawSkeleton 繪製圓點
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
// 計算頭部狀態 (保持不變)
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
  function dist(a, b) { const dx = a.x - b.x; const dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }
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

  // 4. 嘴巴偵測 (邏輯保持不變)
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

  function dist(a, b) { const dx = a.x - b.x; const dy = a.y - b.y; return Math.sqrt(dx * dx + dy * dy); }

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
    tctx.drawImage(videoEl, sx, sy, sw, sh, 0, 0, dw, dh);
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
runPoseDetection().catch(e => console.error('runPoseDetection error', e));