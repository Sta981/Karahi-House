// Stateful box-filter downsampling into 80 ms / 16 kHz / mono PCM16 frames.
// No MediaRecorder, file writes, uploads of past conversations, or audio logging.
class VoiceCapture extends AudioWorkletProcessor {
  constructor(options) {
    super(); this.sum = 0; this.count = 0; this.phase = 0; this.ratio = sampleRate / 16000;
    this.frame = new Int16Array(1280); this.offset = 0; this.samples = 0;
    this.active = false; this.loud = 0; this.quiet = 0; this.lastLoud = 0;
    this.settings=Object.assign({threshold:.024,playbackThreshold:.04,minSpeechMs:480,echoCorrelation:.8},options?.processorOptions);
    this.reference=new Float32Array(2048);this.referenceAt=0;this.lowMic=new Float32Array(160);this.lowAt=0;this.refSum=0;this.lowSum=0;this.lowRefSum=0;this.lowCount=0;this.playbackUntil=0;this.noise=.003;this.peak=0;
  }
  process(inputs) {
    const input = inputs[0]?.[0],reference=inputs[1]?.[0]; if (!input) return true;
    for (let inputAt=0;inputAt<input.length;inputAt++) {
      const sample=input[inputAt];this.sum += sample;this.refSum+=reference?.[inputAt]??0;this.count++; this.phase++;
      if (this.phase < this.ratio) continue;
      const value = this.sum / this.count,ref=this.refSum/this.count;this.phase -= this.ratio; this.sum = 0;this.refSum=0; this.count = 0;
      this.lowSum+=value;this.lowRefSum+=ref;this.lowCount++;
      if(this.lowCount===8){this.lowMic[this.lowAt++]=this.lowSum/8;this.reference[this.referenceAt++%this.reference.length]=this.lowRefSum/8;this.lowSum=0;this.lowRefSum=0;this.lowCount=0;}
      this.frame[this.offset++] = Math.round(Math.max(-1, Math.min(1, value)) * 32767); this.samples++;
      if (this.offset !== this.frame.length) continue;
      let energy = 0; for (const v of this.frame) energy += (v / 32768) ** 2;
      const level = Math.sqrt(energy / this.frame.length);let correlation=0,referenceRms=0;
      let micEnergy=0;for(const value of this.lowMic)micEnergy+=value*value;
      if(micEnergy>.00001)for(let lag=0;lag<=640;lag+=4){
        let cross=0,refEnergy=0;
        for(let index=0;index<160;index++){const ref=this.reference[(this.referenceAt-160-lag+index+4096)%2048];cross+=this.lowMic[index]*ref;refEnergy+=ref*ref;}
        const score=refEnergy>.00001?Math.abs(cross)/Math.sqrt(micEnergy*refEnergy):0;
        if(score>correlation){correlation=score;referenceRms=Math.sqrt(refEnergy/160);}
      }
      let currentReference=0;for(let index=0;index<160;index++)currentReference+=this.reference[(this.referenceAt-160+index+4096)%2048]**2;
      if(Math.sqrt(currentReference/160)>.004)this.playbackUntil=this.samples+7680;
      const echo=correlation>=this.settings.echoCorrelation&&referenceRms>.004&&level<=referenceRms*2.5;
      const threshold=Math.max(this.samples<this.playbackUntil?this.settings.playbackThreshold:this.settings.threshold,this.noise*3);
      const loud=!echo&&level>=threshold;
      if(!this.active&&!loud&&!echo&&level<this.settings.threshold)this.noise=.98*this.noise+.02*level;
      if (loud) {
        this.loud++;this.peak=Math.max(this.peak,level); this.quiet = 0; this.lastLoud = this.samples;
        if (!this.active && this.loud*80>=this.settings.minSpeechMs) { this.active = true; this.port.postMessage({ type: "speech_start", audioSeconds: this.samples / 16000,source:"browser_vad",energy:level,threshold,speechMs:this.loud*80 }); }
      } else {
        if(this.loud&&!this.active)this.port.postMessage({type:"vad_rejected",reason:"short_blip",energy:this.peak,speechMs:this.loud*80});
        this.loud = 0; this.quiet++;
        if (this.active && this.quiet >= 3) { this.active = false; this.port.postMessage({ type: "speech_end", audioSeconds: this.lastLoud / 16000, hangoverMs: (this.samples - this.lastLoud) / 16 }); }
      }
      if(echo){this.frame.fill(0);this.port.postMessage({type:"vad_rejected",reason:"playback_echo",energy:level,correlation});}
      this.port.postMessage({ type: "pcm", pcm: this.frame.buffer, audioSeconds: this.samples / 16000, level }, [this.frame.buffer]);
      this.frame = new Int16Array(1280); this.offset = 0;this.lowAt=0;this.peak=0;
    }
    return true;
  }
}
registerProcessor("voice-capture", VoiceCapture);
