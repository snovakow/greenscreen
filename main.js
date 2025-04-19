const src = document.currentScript.src;
import("../lib/main.js").then(
	main => {
		const gtag = (window.location.host === "snovakow.com") ? 'G-DV1KLMY93N' : false;
		const options = { main: src, gtag };
		main.initialize(options).then(() => import("./app.js"));
	}
);
