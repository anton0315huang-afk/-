const video = document.getElementById("video");
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

// 設定骨架顏色配置
const edges = {
  "5,7": "#FF5252",   // 左上臂
  "7,9": "#FF5252",   // 左前臂
  "6,8": "#FF5252",   // 右上臂
  "8,10": "#FF5252",  // 右前臂
  "5,6": "#FFD740",   // 肩膀橫線
  "5,11": "#64DD17",  // 左軀幹
  "6,12": "#64DD17",  // 右軀幹
  "11,12": "#FFD740", // 髖橫線
  "11,13": "#40C4FF", // 左大腿
  "13,15": "#40C4FF", // 左小腿
  "12,14": "#40C4FF", // 右大腿
  "14,16": "#40C4FF"  // 右小腿
};

// 設定攝影機
async function setupCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480 },  // 改回原解析度
    audio: false
  });
  video.srcObject = stream;
  return new Promise(resolve => {
    video.onloadedmetadata = () => resolve(video);
  });
}

// 主程式：偵測骨架
async function runPoseDetection() {
  const detector = await poseDetection.createDetector(
    poseDetection.SupportedModels.MoveNet,
    { modelType: poseDetection.movenet.modelType.SINGLEPOSE_LIGHTNING }
  );

  await setupCamera();
  video.play();
  canvas.width = video.videoWidth;  // 改回原解析度
  canvas.height = video.videoHeight;  // 改回原解析度

  let frameCount = 0;
  let prevLeftEye = { x: 0, y: 0 };  // 保存左眼位置
  let prevRightEye = { x: 0, y: 0 }; // 保存右眼位置

  async function detect() {
    if (frameCount % 2 === 0) {  // 每 2 幀偵測一次
      const poses = await detector.estimatePoses(video);

      // 背景全黑
      ctx.fillStyle = "black";
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      poses.forEach(pose => {
        drawSkeleton(pose.keypoints);
        drawHeadAndFace(pose.keypoints, prevLeftEye, prevRightEye);
      });
    }
    frameCount++;
    requestAnimationFrame(detect);
  }

  detect();
}

// 繪製骨架
function drawSkeleton(keypoints) {
  Object.keys(edges).forEach(edge => {
    const [p1, p2] = edge.split(",").map(Number);
    const kp1 = keypoints[p1];
    const kp2 = keypoints[p2];

    if (kp1.score > 0.3 && kp2.score > 0.3) {
      ctx.beginPath();
      ctx.moveTo(kp1.x, kp1.y);
      ctx.lineTo(kp2.x, kp2.y);
      ctx.lineWidth = 50;
      ctx.lineCap = "round";
      ctx.strokeStyle = edges[edge];
      ctx.stroke();
    }
  });

  keypoints.forEach(kp => {
    if (kp.score > 0.3) {
      const part = getBodyPart(kp);
      if (part) {
        ctx.beginPath();
        ctx.arc(kp.x, kp.y, part.radius, 0, 2 * Math.PI);
        ctx.fillStyle = part.color;
        ctx.fill();
      }
    }
  });
}

// 根據關鍵點返回相應的部位圖像
function getBodyPart(keypoint) {
  switch (keypoint.part) {
    case "nose":
      return { 
        color: "#FFD740",  // 頭部顏色
        radius: 30 
      };  // 頭部圓形
    case "leftShoulder":
    case "rightShoulder":
    case "leftElbow":
    case "rightElbow":
    case "leftWrist":
    case "rightWrist":
      return { 
        color: "#FF5252",  // 手臂顏色
        radius: 20 
      };  
    case "leftHip":
    case "rightHip":
      return { 
        color: "#64DD17",  // 髖部顏色
        radius: 25 
      };  
    case "leftKnee":
    case "rightKnee":
      return { 
        color: "#40C4FF",  // 膝蓋顏色
        radius: 30 
      };  
    case "leftAnkle":
    case "rightAnkle":
      return { 
        color: "#40C4FF",  // 腳踝顏色
        radius: 30 
      };  
    default:
      return null;
  }
}

// 繪製頭與眼睛
function drawHeadAndFace(keypoints, prevLeftEye, prevRightEye) {
  const nose = keypoints[0];
  const leftEye = keypoints[1];
  const rightEye = keypoints[2];

  if (nose.score < 0.5) return;

  // 計算頭部位置和大小
  const headRadius = 60;
  const headX = nose.x;
  const headY = nose.y;

  // 確保頭部位置穩定，減少波動
  const stableHeadX = prevLeftEye.x + (headX - prevLeftEye.x) * 0.2;
  const stableHeadY = prevLeftEye.y + (headY - prevLeftEye.y) * 0.2;

  // 畫頭部
  ctx.beginPath();
  ctx.arc(stableHeadX, stableHeadY, headRadius, 0, Math.PI * 2);  // 頭部圓形
  ctx.fillStyle = "#FFD740";  // 頭部顏色
  ctx.fill();
  ctx.strokeStyle = "#FFD740";  // 頭部邊框顏色
  ctx.lineWidth = 4;
  ctx.stroke();

  // 畫眼睛
  drawEyes(leftEye, rightEye, stableHeadX, stableHeadY, headRadius, prevLeftEye, prevRightEye);
}

// 根據眼睛的狀態畫眼睛，並加入位置限制
function drawEyes(leftEye, rightEye, headX, headY, headRadius, prevLeftEye, prevRightEye) {
  const eyeSize = 10;
  
  // 限制眼睛在頭部圓形內的範圍
  const maxEyeDistance = headRadius * 0.5;  // 眼睛位置最大距離，避免眼睛超出頭部

  let leftEyeX = leftEye.x;
  let leftEyeY = leftEye.y;
  let rightEyeX = rightEye.x;
  let rightEyeY = rightEye.y;

  // 儲存穩定的眼睛位置
  if (leftEye.score > 0.5) {
    leftEyeX = Math.min(Math.max(leftEye.x, headX - maxEyeDistance), headX + maxEyeDistance);
    leftEyeY = Math.min(Math.max(leftEye.y, headY - maxEyeDistance), headY + maxEyeDistance);
  } else {
    // 當閉眼時，保持之前的位置
    leftEyeX = prevLeftEye.x;
    leftEyeY = prevLeftEye.y;
  }

  if (rightEye.score > 0.5) {
    rightEyeX = Math.min(Math.max(rightEye.x, headX - maxEyeDistance), headX + maxEyeDistance);
    rightEyeY = Math.min(Math.max(rightEye.y, headY - maxEyeDistance), headY + maxEyeDistance);
  } else {
    // 當閉眼時，保持之前的位置
    rightEyeX = prevRightEye.x;
    rightEyeY = prevRightEye.y;
  }

  // 畫眼睛
  if (leftEye.score > 0.5 && rightEye.score > 0.5) {
    // 眼睛睜開
    ctx.beginPath();
    ctx.arc(leftEyeX, leftEyeY, eyeSize, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";  // 白色睜眼
    ctx.fill();
    ctx.strokeStyle = "#000";  // 眼睛邊框
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(rightEyeX, rightEyeY, eyeSize, 0, Math.PI * 2);
    ctx.fillStyle = "#FFFFFF";  // 眼睛睜開
    ctx.fill();
    ctx.strokeStyle = "#000";  // 眼睛邊框
    ctx.lineWidth = 2;
    ctx.stroke();
  } else {
    // 眼睛閉合
    ctx.beginPath();
    ctx.arc(leftEyeX, leftEyeY, eyeSize, Math.PI, 0);  // 半圓閉眼
    ctx.fillStyle = "#888";  // 閉眼顏色
    ctx.fill();

    ctx.beginPath();
    ctx.arc(rightEyeX, rightEyeY, eyeSize, Math.PI, 0);  // 半圓閉眼
    ctx.fillStyle = "#888";  // 閉眼顏色
    ctx.fill();
  }

  // 儲存當前眼睛位置
  prevLeftEye.x = leftEyeX;
  prevLeftEye.y = leftEyeY;
  prevRightEye.x = rightEyeX;
  prevRightEye.y = rightEyeY;
}

runPoseDetection();