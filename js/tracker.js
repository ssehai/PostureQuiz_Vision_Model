// 카메라 + MediaPipe Pose Landmarker (브라우저 안에서만 처리, 영상은 외부로 전송되지 않음)
const TASKS_VER = '0.10.14';
const MODEL_URLS = {
  lite: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
  full: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task',
};

// 연결된 카메라 목록 (권한을 받기 전에는 이름이 비어 있을 수 있음)
export async function listCameras() {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  const all = await navigator.mediaDevices.enumerateDevices();
  return all.filter((d) => d.kind === 'videoinput');
}

export class CameraTracker {
  constructor(video) {
    this.kind = 'camera';
    this.video = video;
    this.stream = null;
    this.landmarker = null;
    this.lastVideoTime = -1;
    this.lastResult = [];
  }

  async start(model = 'lite', deviceId = '') {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('이 주소에서는 카메라를 쓸 수 없어요. http://localhost:8000 으로 열어 주세요.');
    }
    this.model = model;
    this.deviceId = deviceId;
    // 1) 카메라 먼저 켠다 (모델 다운로드 실패와 카메라 문제를 구분하기 위해)
    const video = { width: { ideal: 1280 }, height: { ideal: 720 } };
    if (deviceId) video.deviceId = { exact: deviceId };
    else video.facingMode = 'user';
    this.stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
    this.video.muted = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.label = this.stream.getVideoTracks()[0]?.label || '카메라';

    // 2) AI 모델 불러오기
    let FilesetResolver, PoseLandmarker;
    try {
      ({ FilesetResolver, PoseLandmarker } = await import(
        `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${TASKS_VER}/vision_bundle.mjs`
      ));
    } catch (e) {
      this.stop();
      throw new Error('AI 모델을 내려받지 못했어요. 인터넷 연결을 확인해 주세요.');
    }

    try {
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
    } catch (e) {
      this.stop();
      throw new Error(`AI 모델을 준비하지 못했어요: ${e.message || e}`);
    }
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    try { this.landmarker?.close(); } catch { /* 무시 */ }
    this.landmarker = null;
    this.lastResult = [];
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
