// 完整整合版（不使用額外模型）：
// - MoveNet 偵測骨架（頭部位置與大小）
// - 不旋轉頭圖（以鼻子為中心）
// - 動態縮放頭圖（肩寬/眼距）並平滑
// - 無模型下估計下嘴唇：在 MoveNet 定位的 face ROI 做 downscale 顏色投影（R - (G+B)/2）找出 lower lip 行位置
// - 將 lowerLipY 與鼻子做尺度正規化，接著 baseline + 平滑 + hysteresis + 多幀確認 判斷 mouthOpen
// 可直接替換你現有檔案（只需確保已引入 MoveNet、且頁面有 video + canvas 元素）

const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// 設定與資源
const edges = {
  "5,7": "#FF5252", "7,9": "#FF5252",
  "6,8": "#FF5252", "8,10": "#FF5252",
  "5,6": "#FFD740", "5,11": "#64DD17",
  "6,12": "#64DD17", "11,12": "#FFD740",
  "11,13": "#40C4FF", "13,15": "#40C4FF",
  "12,14": "#40C4FF", "14,16": "#40C4FF"
};

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

// ---- 主程式 ----
async function runPoseDetection() {
  const detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );

  await setupCamera();
  await video.play().catch(() => {}); // 若被瀏覽器策略阻擋，caller 可在互動後再呼叫
  canvas.width = video.videoWidth || video.width;
  canvas.height = video.videoHeight || video.height;

  let frameCount = 0;
  let prevState = { eyesOpen: true, mouthOpen: false };
  let stableHead = { x: canvas.width / 2, y: canvas.height / 2, scale: 220 };
  // store last successful lowerLipY and control rate
  prevState._lastLowerLipY = null;
  prevState._lastLowerLipFrame = 0;

  // tmp canvas reuse for ROI processing
  const tmpCanvas = document.createElement('canvas');
  const tctx = tmpCanvas.getContext('2d');

  async function detect() {
    requestAnimationFrame(detect);

    // 每 2 幀做一次 pose (效能考量)
    if (frameCount % 2 === 0) {
      const poses = await detector.estimatePoses(video);

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      poses.forEach(pose => {
        // 嘗試估計 lowerLipY（每 N 幀執行一次）
        const lowerLipInterval = 4; // 每 4 幀做一次像素偵測
        let lowerLipY = null;
        if (frameCount - prevState._lastLowerLipFrame >= lowerLipInterval) {
          lowerLipY = estimateLowerLipYFromFrame(pose.keypoints, video, tctx, tmpCanvas, {
            targetWidth: 140,
            redThreshold: 18,
            minMaskPixels: 20
          });
          prevState._lastLowerLipFrame = frameCount;
          if (lowerLipY !== null) prevState._lastLowerLipY = lowerLipY;
        } else {
          lowerLipY = prevState._lastLowerLipY;
        }

        drawHeadAndFace(pose.keypoints, stableHead, prevState, lowerLipY);
        drawSkeleton(pose.keypoints, stableHead.scale);
      });
    }

    frameCount++;
  }

  detect();
}

// ---- 繪製骨架 ----
function drawSkeleton(keypoints, headScale = 220) {
  const baseLineWidth = Math.max(8, Math.min(80, headScale / 4));
  Object.keys(edges).forEach(edge => {
    const [p1, p2] = edge.split(",").map(Number);
    const kp1 = keypoints[p1];
    const kp2 = keypoints[p2];
    if (kp1.score > 0.3 && kp2.score > 0.3) {
      ctx.beginPath();
      ctx.moveTo(kp1.x, kp1.y);
      ctx.lineTo(kp2.x, kp2.y);
      ctx.lineWidth = baseLineWidth;
      ctx.lineCap = "round";
      ctx.strokeStyle = edges[edge];
      ctx.stroke();
    }
  });

  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      const part = getBodyPart(kp, headScale);
      if (part) {
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, part.radius, 0, Math.PI * 2);
        ctx.fillStyle = part.color;
        ctx.fill();
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

// ---- 在畫布上繪製頭部與臉（不旋轉） ----
function drawHeadAndFace(keypoints, stableHead, prevState, lowerLipYFromROI) {
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

  // 平滑頭位置
  stableHead.x += (nose.x - stableHead.x) * 0.2;
  stableHead.y += (nose.y - stableHead.y) * 0.2;

  // 眼睛狀態（只影響圖選擇）
  const eyesOpen = leftEye.score > 0.5 && rightEye.score > 0.5;
  prevState.eyesOpen = eyesOpen;

  // 計算 headSize（肩寬、眼距或耳距）
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

  // ---- 嘴巴偵測：使用 ROI lowerLipY（若有），否則 fallback to mouth corners ----
  if (prevState._mouthOpenCounter === undefined) prevState._mouthOpenCounter = 0;
  if (prevState._mouthCloseCounter === undefined) prevState._mouthCloseCounter = 0;
  if (prevState._smoothedNormalized === undefined) prevState._smoothedNormalized = 0;
  if (prevState._baselineSum === undefined) prevState._baselineSum = 0;
  if (prevState._baselineFrames === undefined) prevState._baselineFrames = 0;
  if (prevState._baselineAvg === undefined) prevState._baselineAvg = 0;

  let mouthOpen = prevState.mouthOpen;

  // 決定使用哪個 y 作為 mouth vertical indicator（prefer lowerLipYFromROI）
  let mouthIndicatorY = null;
  if (typeof lowerLipYFromROI === 'number') {
    mouthIndicatorY = lowerLipYFromROI;
  } else if (leftMouth && rightMouth && leftMouth.score > 0.3 && rightMouth.score > 0.3) {
    mouthIndicatorY = (leftMouth.y + rightMouth.y) / 2;
  }

  if (mouthIndicatorY !== null) {
    const normalized = (mouthIndicatorY - nose.y) / headSize;

    // baseline 收集（前幾幀當 neutral）
    const BASELINE_FRAMES = 30;
    if (prevState._baselineFrames < BASELINE_FRAMES) {
      prevState._baselineSum += normalized;
      prevState._baselineFrames++;
      prevState._baselineAvg = prevState._baselineSum / prevState._baselineFrames;
    }

    // 平滑 normalized
    if (!prevState._smoothedNormalized && prevState._smoothedNormalized !== 0) prevState._smoothedNormalized = normalized;
    prevState._smoothedNormalized += (normalized - prevState._smoothedNormalized) * 0.12;
    const smoothed = prevState._smoothedNormalized;

    // hysteresis thresholds
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
    // 無可用 indicator -> 維持上一幀狀態
    mouthOpen = prevState.mouthOpen;
  }
  prevState.mouthOpen = mouthOpen;

  // 選圖並繪製（不旋轉）
  let img;
  if (eyesOpen && mouthOpen) img = eyeMouthImgs.openEyeOpenMouth;
  else if (eyesOpen && !mouthOpen) img = eyeMouthImgs.openEyeCloseMouth;
  else if (!eyesOpen && mouthOpen) img = eyeMouthImgs.closeEyeOpenMouth;
  else img = eyeMouthImgs.closeEyeCloseMouth;

  const imgWidth = stableHead.scale;
  const imgHeight = stableHead.scale;
  const offsetY = 0;
  ctx.drawImage(img, stableHead.x - imgWidth / 2, stableHead.y - imgHeight / 2 + offsetY, imgWidth, imgHeight);
}

// ---- 無模型下估計下嘴唇的函式（顏色 + 投影法） ----
// 參數：keypoints, video element, tctx (tmp canvas 2D context), tmpCanvas DOM element, opts
// 回傳：lowerLipY (畫布座標) 或 null
function estimateLowerLipYFromFrame(keypoints, videoEl, tctx, tmpCanvas, opts = {}) {
  const nose = keypoints[0];
  const leftEye = keypoints[1];
  const rightEye = keypoints[2];
  const leftEar = keypoints[3];
  const rightEar = keypoints[4];
  const leftShoulder = keypoints[5];
  const rightShoulder = keypoints[6];

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