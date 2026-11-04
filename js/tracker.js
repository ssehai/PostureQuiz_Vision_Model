// 카메라 + MediaPipe Pose Landmarker (브라우저 안에서만 처리, 영상은 외부로 전송되지 않음)
const TASKS_VER = '0.10.14';
const MODEL_URLS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

export class CameraTracker {
  constructor(video) {
    this.video = video;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastResult = [];
  }

  async start(model = 'lite') {
    const { FilesetResolver, PoseLandmarker } = await import(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VER}/vision_bundle.mjs`
    );
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
      audio: false,
    });
    this.video.srcObject = stream;
    await this.video.play();

    const fileset = await FilesetResolver.forVisionTasks(
      `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VER}/wasm`
    );
    const opts = (delegate) => ({
      baseOptions: { modelAssetPath: MODEL_URLS[model] || MODEL_URLS.lite, delegate },
      runningMode: 'VIDEO',
      numPoses: 2,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    try {
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('GPU'));
    } catch (e) {
      console.warn('GPU 실패, CPU로 전환', e);
      this.landmarker = await PoseLandmarker.createFromOptions(fileset, opts('CPU'));
    }
  }

  get width() { return this.video.videoWidth || 1280; }
  get height() { return this.video.videoHeight || 720; }

  // 화면 기준(거울 반전) 랜드마크 배열들을 반환
  detect(nowMs) {
    if (!this.landmarker || this.video.readyState < 2) return this.lastResult;
    if (this.video.currentTime === this.lastVideoTime) return this.lastResult;
    this.lastVideoTime = this.video.currentTime;
    const res = this.landmarker.detectForVideo(this.video, nowMs);
    this.lastResult = (res.landmarks || []).map((lms) =>
      lms.map((p) => ({ x: 1 - p.x, y: p.y, visibility: p.visibility }))
    );
    return this.lastResult;
  }

  drawFrame(ctx, w, h) {
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(this.video, 0, 0, w, h);
    ctx.restore();
  }
}
