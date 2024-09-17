import './style.css';
import firebase from 'firebase/app';
import 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyD1b7InCyJf03f82MBrFCXNd_1lir3nWrQ",
  authDomain: "lil-testing.firebaseapp.com",
  projectId: "lil-testing",
  storageBucket: "lil-testing.appspot.com",
  messagingSenderId: "309006701748",
  appId: "1:309006701748:web:2cfa73093e14fbcc2af3e1"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}
const firestore = firebase.firestore();

const servers = {
  iceServers: [
    {
      urls: ['stun:stun1.l.google.com:19302', 'stun:stun2.l.google.com:19302'],
    },
  ],
  iceCandidatePoolSize: 10,
};

// Global State
const pc = new RTCPeerConnection(servers);
let localStream = null;
let remoteStream = null;
let audioContext = null;
let localAudioSource = null;
let audioGainNode = null;

const webcamButton = document.getElementById('webcamButton');
const muteButton = document.getElementById('muteButton');
const webcamVideo = document.getElementById('webcamVideo');
const callButton = document.getElementById('callButton');
const callInput = document.getElementById('callInput');
const answerButton = document.getElementById('answerButton');
const remoteVideo = document.getElementById('remoteVideo');
const hangupButton = document.getElementById('hangupButton');

let isMuted = false;

// Function to set audio output to speakerphone on mobile
const setAudioOutputToSpeaker = (videoElement) => {
  if ('mediaDevices' in navigator) {
    navigator.mediaDevices.enumerateDevices().then(devices => {
      const audioOutputDevices = devices.filter(device => device.kind === 'audiooutput');
      if (audioOutputDevices.length > 0) {
        videoElement.setSinkId(audioOutputDevices[0].deviceId).catch(error => {
          console.error('Error setting sink ID:', error);
        });
      }
    });
  }
};

// Function to setup audio context and routing
const setupAudioContext = () => {
  audioContext = new AudioContext();
  audioGainNode = audioContext.createGain();
  
  // Connect audio gain node to the destination (speakers)
  audioGainNode.connect(audioContext.destination);
};

// 1. Setup media sources
webcamButton.onclick = async () => {
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  remoteStream = new MediaStream();

  // Push tracks from local stream to peer connection
  localStream.getTracks().forEach((track) => {
    pc.addTrack(track, localStream);
  });

  // Pull tracks from remote stream, add to video stream
  pc.ontrack = (event) => {
    event.streams[0].getTracks().forEach((track) => {
      remoteStream.addTrack(track);
    });
  };

  webcamVideo.srcObject = localStream;
  remoteVideo.srcObject = remoteStream;

  // Set audio output to speakerphone if mobile
  if (navigator.userAgent.match(/(iPhone|iPod|iPad|Android)/i)) {
    setAudioOutputToSpeaker(remoteVideo);
  }

  // Setup audio context and routing
  setupAudioContext();

  // Create an audio source from the local stream and connect it to the audio gain node
  const localAudioTrack = localStream.getAudioTracks()[0];
  if (localAudioTrack) {
    localAudioSource = audioContext.createMediaStreamSource(new MediaStream([localAudioTrack]));
    localAudioSource.connect(audioGainNode);
  }

  callButton.disabled = false;
  answerButton.disabled = false;
  webcamButton.disabled = true;
  muteButton.disabled = false; // Enable mute button
};

// 2. Create an offer
callButton.onclick = async () => {
  const callDoc = firestore.collection('calls').doc();
  const offerCandidates = callDoc.collection('offerCandidates');
  const answerCandidates = callDoc.collection('answerCandidates');

  callInput.value = callDoc.id;

  pc.onicecandidate = (event) => {
    event.candidate && offerCandidates.add(event.candidate.toJSON());
  };

  const offerDescription = await pc.createOffer();
  await pc.setLocalDescription(offerDescription);

  const offer = {
    sdp: offerDescription.sdp,
    type: offerDescription.type,
  };

  await callDoc.set({ offer });

  callDoc.onSnapshot((snapshot) => {
    const data = snapshot.data();
    if (!pc.currentRemoteDescription && data?.answer) {
      const answerDescription = new RTCSessionDescription(data.answer);
      pc.setRemoteDescription(answerDescription);
    }
  });

  answerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });

  hangupButton.disabled = false;
};

// 3. Answer the call with the unique ID
answerButton.onclick = async () => {
  const callId = callInput.value;
  const callDoc = firestore.collection('calls').doc(callId);
  const answerCandidates = callDoc.collection('answerCandidates');
  const offerCandidates = callDoc.collection('offerCandidates');

  pc.onicecandidate = (event) => {
    event.candidate && answerCandidates.add(event.candidate.toJSON());
  };

  const callData = (await callDoc.get()).data();

  const offerDescription = callData.offer;
  await pc.setRemoteDescription(new RTCSessionDescription(offerDescription));

  const answerDescription = await pc.createAnswer();
  await pc.setLocalDescription(answerDescription);

  const answer = {
    type: answerDescription.type,
    sdp: answerDescription.sdp,
  };

  await callDoc.update({ answer });

  offerCandidates.onSnapshot((snapshot) => {
    snapshot.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const candidate = new RTCIceCandidate(change.doc.data());
        pc.addIceCandidate(candidate);
      }
    });
  });
};

// 4. Mute/Unmute Audio
muteButton.onclick = () => {
  isMuted = !isMuted;
  localStream.getAudioTracks().forEach(track => {
    track.enabled = !isMuted;
  });
  if (audioGainNode) {
    audioGainNode.gain.value = isMuted ? 0 : 1;
  }
  muteButton.textContent = isMuted ? 'Unmute Audio' : 'Mute Audio';
};

// 5. Hangup
hangupButton.onclick = () => {
  pc.close();
  pc = new RTCPeerConnection(servers);
  localStream = null;
  remoteStream = null;
  webcamButton.disabled = false;
  callButton.disabled = true;
  answerButton.disabled = true;
  hangupButton.disabled = true;
  muteButton.disabled = true;
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
};
