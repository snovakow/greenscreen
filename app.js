import {
	Vector2, Color, ShaderMaterial, Mesh, Scene, OrthographicCamera, WebGLRenderer,
	PlaneGeometry, BackSide, FrontSide, VideoTexture, SRGBColorSpace, LinearFilter,
} from 'three';

import { GUI } from 'three/addons/libs/lil-gui.module.min.js';

const RGBtoUV = (r, g, b) => {
	const u = r * -0.169 + g * -0.331 + b * 0.5 + 0.5;
	const v = r * 0.5 + g * -0.419 + b * -0.081 + 0.5;
	return [u, v];
}

const vertexShaderString = `
varying vec2 vTextureCoord;
void main(void) {
	vTextureCoord = uv;
	gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}
`;

const fragmentShader = `
// From https://github.com/obsproject/obs-studio/blob/master/plugins/obs-filters/data/chroma_key_filter.effect

uniform sampler2D uSampler;

uniform float u_saturation;

uniform vec3 color;
uniform float contrast;
uniform float brightness;
uniform float gamma;

uniform vec2 chromakey;
uniform vec2 pixelSize;
uniform float u_similarity;
uniform float u_smoothness;
uniform float u_spill;

varying vec2 vTextureCoord;

const mat4 yuv_mat = mat4(
	0.182586, 0.614231, 0.062007, 0.062745,
	-0.100644, -0.338572, 0.439216, 0.501961,
	0.439216, -0.398942, -0.040274, 0.501961,
	0.000000, 0.000000, 0.000000, 1.000000
);

vec3 CalcColor(inout vec3 rgb) {
	return pow(rgb, vec3(gamma, gamma, gamma)) * contrast + brightness;
}

float GetChromaDist(in vec3 rgb) {
	vec4 yuvx = vec4(rgb, 1.0) * yuv_mat;
	return distance(chromakey, yuvx.yz);
}

// From https://thebookofshaders.com/06/
const vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
vec3 rgb2hsb(in vec3 c) {
	vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
	vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
	float d = q.x - min(q.w, q.y);
	float e = 1.0e-10;
	return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}
vec3 hsb2rgb(in vec3 c) {
	vec3 rgb = clamp(abs(mod(c.x*6.0+vec3(0.0,4.0,2.0),6.0)-3.0)-1.0, 0.0, 1.0);
	rgb = rgb*rgb*(3.0-2.0*rgb);
	return c.z * mix(vec3(1.0), rgb, c.y);
}
void changeSaturation(inout vec3 rgb, float change) {
	vec3 hsb = rgb2hsb(rgb);
	hsb.g *= change;
	rgb = hsb2rgb(hsb);
}

float GetBoxFilteredChromaDist(in vec3 rgb, in vec2 texCoord) {
	vec2 h_pixel_size = pixelSize / 2.0;
	vec2 point_0 = vec2(pixelSize.x, h_pixel_size.y);
	vec2 point_1 = vec2(h_pixel_size.x, -pixelSize.y);

	float distVal = GetChromaDist(texture2D(uSampler, texCoord-point_0).rgb);
	distVal += GetChromaDist(texture2D(uSampler, texCoord+point_0).rgb);
	distVal += GetChromaDist(texture2D(uSampler, texCoord-point_1).rgb);
	distVal += GetChromaDist(texture2D(uSampler, texCoord+point_1).rgb);
	distVal *= 2.0;
	distVal += GetChromaDist(rgb);
	return distVal / 9.0;
}

void main(void) {
	float a = 1.0;

	vec3 rgb = texture2D(uSampler, vTextureCoord).rgb;
	float chromaDist = GetBoxFilteredChromaDist(rgb, vTextureCoord);

	float baseMask = chromaDist - u_similarity;
	a *= pow(clamp(baseMask / u_smoothness, 0.0, 1.0), 1.5);
	if(a < 0.01) discard;

	rgb *= color.rgb;

	float desat = clamp(rgb.r * 0.2126 + rgb.g * 0.7152 + rgb.b * 0.0722, 0.0, 1.0);

	if(u_saturation != 1.0) changeSaturation(rgb, u_saturation);

	float spillVal = pow(clamp(baseMask / u_spill, 0.0, 1.0), 1.5);
	rgb = mix(vec3(desat, desat, desat), rgb, spillVal);

	gl_FragColor = vec4(CalcColor(rgb), a);
}
`;

const chromakey = new Color().setHex(0x00ff00);

const uniforms = {
	pixelSize: { value: new Vector2(1, 1) },
	color: { value: new Color(0xffffff) },
	contrast: { value: 1 },
	brightness: { value: 0 },
	gamma: { value: 1 },
	chromakey: { value: new Vector2(...RGBtoUV(chromakey.r, chromakey.g, chromakey.b)) },
	u_similarity: { value: 0.4 },
	u_smoothness: { value: 0.08 },
	u_spill: { value: 0.1 },
	u_saturation: { value: 1 },
	uSampler: { value: null },
};
const material = new ShaderMaterial({
	uniforms: uniforms,
	vertexShader: vertexShaderString,
	fragmentShader: fragmentShader
});

const geometry = new PlaneGeometry(1, 1);
const mesh = new Mesh(geometry, material);
mesh.material.side = FrontSide;
const degToRad = Math.PI / 180;
const radToDeg = 180 / Math.PI;

const scene = new Scene();
scene.background = new Color(0x000000);
scene.add(mesh);

const camera = new OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.5, -0.5);

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

renderer.domElement.style.position = 'fixed';
renderer.domElement.style.top = '0px';
renderer.domElement.style.left = '0px';
renderer.domElement.style.width = '100%';
renderer.domElement.style.height = '100%';

document.body.appendChild(renderer.domElement);

let videoLoaded = false;
const video = document.createElement("video");
video.autoplay = true;
video.playsinline = true;

video.style.position = 'fixed';
video.style.bottom = '0px';
video.style.right = '0px';
video.style.width = '160px';
document.body.appendChild(video);

const resizeVideo = () => {
	const windowAR = window.innerWidth / window.innerHeight;
	const videoAR = video.videoWidth / video.videoHeight;
	if (videoAR > windowAR) {
		mesh.scale.set(1, windowAR / videoAR, 1);
	} else {
		mesh.scale.set(videoAR / windowAR, 1, 1);
	}

	const pixSize = material.uniforms.pixelSize.value;
	pixSize.x = 1 / renderer.domElement.width;
	pixSize.y = 1 / renderer.domElement.height;
}
video.addEventListener("loadedmetadata", () => {
	videoLoaded = true;
	// mesh.material.color.set(0xffffff);
	resizeVideo();
});

const windowResize = () => {
	renderer.setSize(window.innerWidth, window.innerHeight);
	if (videoLoaded) resizeVideo();
}
window.addEventListener('resize', windowResize);

let previousTime = 0;
const animate = (msTime) => {
	if (previousTime === 0) {
		previousTime = msTime;
	}
	const deltaTime = msTime - previousTime;
	previousTime = msTime;

	if (renderer.getPixelRatio() !== window.devicePixelRatio) renderer.setPixelRatio(window.devicePixelRatio);

	renderer.render(scene, camera);
}
renderer.setAnimationLoop(animate);

const gui = new GUI();

const settings = {
	flip: false,
	color: material.uniforms.color.value.getHex(),
	chromakey: chromakey.getHex(),
};
gui.add(settings, 'flip').name("Flip").onChange((state) => {
	if (state) {
		mesh.rotation.y = 180 * degToRad;
		mesh.material.side = BackSide;
	} else {
		mesh.rotation.y = 0;
		mesh.material.side = FrontSide;
	}
});
gui.addColor(settings, 'color').name("Color").onChange((color) => {
	material.uniforms.color.value.setHex(color);
});

gui.add(material.uniforms.contrast, 'value', 0, 2).name('Contrast');
gui.add(material.uniforms.brightness, 'value', -1, 1).name('Brightness');
gui.add(material.uniforms.gamma, 'value', 1, 2.2).name('Gamma');
gui.addColor(settings, 'chromakey').onChange((color) => {
	chromakey.setHex(color);
	material.uniforms.chromakey.value.set(...RGBtoUV(chromakey.r, chromakey.g, chromakey.b));
});
gui.add(material.uniforms.u_similarity, 'value', 0, 1).name('Similarity');
gui.add(material.uniforms.u_smoothness, 'value', 0, 1).name('Smoothness');
gui.add(material.uniforms.u_spill, 'value', 0, 1).name('Spill');
gui.add(material.uniforms.u_saturation, 'value', 0, 2).name('Saturation');

// const shadowMapTypes = {
// 	BasicShadowMap: THREE.BasicShadowMap,
// 	PCFShadowMap: THREE.PCFShadowMap,
// 	PCFSoftShadowMap: THREE.PCFSoftShadowMap,
// 	VSMShadowMap: THREE.VSMShadowMap,
// };
// gui.add(Env.renderer.shadowMap, 'type', shadowMapTypes).name('shadowMap').onChange = () => {
// 	Env.renderer.shadowMap.needsUpdate = true;
// };

if (!navigator.mediaDevices?.enumerateDevices) {
	console.log("enumerateDevices() not supported.");
} else {
	// List cameras and microphones.
	navigator.mediaDevices
		.enumerateDevices()
		.then((devices) => {
			devices.forEach((device) => {
				// console.log(device);
			});
		})
		.catch((err) => {
			console.error(`${err.name}: ${err.message}`);
		});
}

async function getMedia(constraints) {
	let stream = null;

	try {
		stream = await navigator.mediaDevices.getUserMedia(constraints);
		video.srcObject = stream;
		video.play();

		const texture = new VideoTexture(video);
		texture.colorSpace = SRGBColorSpace;
		texture.minFilter = LinearFilter;
		if (mesh.material.map) mesh.material.map.dispose();
		mesh.material.map = texture;
		mesh.material.needsUpdate = true;
		uniforms.uSampler.value = texture;
	} catch (err) {
		console.log(err);
	}
}

const constraints = { audio: false, video: true };
const button = document.createElement('button');
button.textContent = "Load";
button.onclick = () => {
	videoLoaded = false;
	getMedia(constraints);
}
button.style.position = 'absolute';
button.style.bottom = '0px';
button.style.right = '0px';
document.body.appendChild(button);

getMedia(constraints);
