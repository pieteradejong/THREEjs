// Color palette matching the rug from the image
const colorPalette = [
	// Reds
	0x8B0000, // Deep burgundy
	0xFF0000, // Bright red
	0xFF7F7F, // Coral/salmon pink
	
	// Blues
	0x0000CD, // Royal blue
	0x87CEEB, // Sky blue
	0x9370DB, // Periwinkle/lavender blue
	
	// Greens
	0x32CD32, // Lime green
	0x808000, // Olive green
	0x006400, // Forest green
	
	// Yellows/Oranges
	0xFFFF00, // Bright yellow
	0xFFD700, // Mustard yellow
	0xFF8C00, // Vivid orange
	0xFF4500, // Burnt orange
	
	// Purples
	0x8B008B, // Deep plum purple
	0xE6E6FA, // Lavender
	
	// Neutrals
	0x000000, // Black
	0x2F2F2F, // Dark brown/charcoal gray
];

// Procedural pattern generation
function generateCarpetPattern() {
	const carpetGroup = new THREE.Group();
	const blockThickness = 0.1; // Slight thickness for 3D effect
	const carpetSize = 20; // Overall carpet size
	const minBlockSize = 1;
	const maxBlockSize = 4;
	const numBlocks = 40; // Number of blocks to generate
	
	// Track occupied areas to prevent excessive overlap
	const occupiedGrid = new Map();
	const gridSize = 0.5; // Grid resolution for collision detection
	
	// Helper function to check if area is available (allows some overlap for interlocking)
	function canPlaceBlock(x, y, width, height) {
		const checkPoints = [];
		const margin = 0.3; // Allow some overlap
		
		// Check corners and center
		checkPoints.push(
			[Math.floor((x - width/2 + margin) / gridSize), Math.floor((y - height/2 + margin) / gridSize)],
			[Math.floor((x + width/2 - margin) / gridSize), Math.floor((y - height/2 + margin) / gridSize)],
			[Math.floor((x - width/2 + margin) / gridSize), Math.floor((y + height/2 - margin) / gridSize)],
			[Math.floor((x + width/2 - margin) / gridSize), Math.floor((y + height/2 - margin) / gridSize)],
			[Math.floor(x / gridSize), Math.floor(y / gridSize)]
		);
		
		// Allow placement if at least 2 check points are free (enables interlocking)
		let freePoints = 0;
		for (const [gx, gy] of checkPoints) {
			const key = `${gx},${gy}`;
			if (!occupiedGrid.has(key)) {
				freePoints++;
			}
		}
		return freePoints >= 2;
	}
	
	// Mark area as occupied
	function markOccupied(x, y, width, height) {
		const startX = Math.floor((x - width/2) / gridSize);
		const endX = Math.floor((x + width/2) / gridSize);
		const startY = Math.floor((y - height/2) / gridSize);
		const endY = Math.floor((y + height/2) / gridSize);
		
		for (let gx = startX; gx <= endX; gx++) {
			for (let gy = startY; gy <= endY; gy++) {
				occupiedGrid.set(`${gx},${gy}`, true);
			}
		}
	}
	
	// Generate blocks with better interlocking pattern
	// Start with some larger blocks, then fill in with smaller ones
	const blockSizes = [];
	for (let i = 0; i < Math.floor(numBlocks * 0.3); i++) {
		blockSizes.push({ size: 'large', priority: 1 });
	}
	for (let i = 0; i < numBlocks - Math.floor(numBlocks * 0.3); i++) {
		blockSizes.push({ size: 'normal', priority: 2 });
	}
	// Shuffle
	blockSizes.sort(() => Math.random() - 0.5);
	
	for (let i = 0; i < numBlocks; i++) {
		let attempts = 0;
		let placed = false;
		const blockConfig = blockSizes[i] || { size: 'normal', priority: 2 };
		
		while (!placed && attempts < 100) {
			// Random position within carpet bounds
			const x = (Math.random() - 0.5) * carpetSize;
			const y = (Math.random() - 0.5) * carpetSize;
			
			// Size based on block config
			let width, height;
			if (blockConfig.size === 'large') {
				width = maxBlockSize * 0.7 + Math.random() * (maxBlockSize - maxBlockSize * 0.7);
				height = maxBlockSize * 0.7 + Math.random() * (maxBlockSize - maxBlockSize * 0.7);
			} else {
				width = minBlockSize + Math.random() * (maxBlockSize - minBlockSize);
				height = minBlockSize + Math.random() * (maxBlockSize - minBlockSize);
			}
			
			// Prefer axis-aligned blocks for better interlocking, but allow some rotation
			const rotation = Math.random() < 0.8 ? (Math.random() < 0.5 ? 0 : Math.PI / 2) : Math.random() * Math.PI * 2;
			
			if (canPlaceBlock(x, y, width, height)) {
				// Create block geometry
				const geometry = new THREE.BoxGeometry(width, height, blockThickness);
				
				// Random color from palette
				const color = colorPalette[Math.floor(Math.random() * colorPalette.length)];
				
				// Create material with slight variation for visual interest
				const material = new THREE.MeshStandardMaterial({
					color: color,
					roughness: 0.7 + Math.random() * 0.2, // Slight roughness variation
					metalness: 0.1,
				});
				
				const block = new THREE.Mesh(geometry, material);
				
				// Position and rotate
				block.position.set(x, y, blockThickness / 2);
				block.rotation.z = rotation;
				
				// Store initial z position and rotation for animation
				block.userData.initialZ = blockThickness / 2 + (Math.random() - 0.5) * 0.05;
				block.userData.initialRotationZ = rotation;
				block.userData.animationOffset = Math.random() * Math.PI * 2; // Random phase for animation
				block.position.z = block.userData.initialZ;
				
				carpetGroup.add(block);
				markOccupied(x, y, width, height);
				placed = true;
			}
			attempts++;
		}
	}
	
	return carpetGroup;
}

// Initialize scene
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });

renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setClearColor("#f5f5f5"); // Light background
renderer.shadowMap.enabled = true; // Enable shadows
document.body.appendChild(renderer.domElement);

// Camera positioning - angled view
camera.position.set(15, 15, 15);
camera.lookAt(0, 0, 0);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
scene.add(ambientLight);

const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
directionalLight.position.set(10, 20, 10);
directionalLight.castShadow = true;
directionalLight.shadow.mapSize.width = 2048;
directionalLight.shadow.mapSize.height = 2048;
scene.add(directionalLight);

// Create hardwood floor
const floorGeometry = new THREE.PlaneGeometry(30, 30);
const floorMaterial = new THREE.MeshStandardMaterial({
	color: 0x8B4513, // Brown wood color
	roughness: 0.8,
	metalness: 0.1,
});
const floor = new THREE.Mesh(floorGeometry, floorMaterial);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.1;
floor.receiveShadow = true;
scene.add(floor);

// Generate carpet
const carpet = generateCarpetPattern();
scene.add(carpet);

// Animation variables
let animationEnabled = true;
let time = 0;

// Animation function
function animate() {
	requestAnimationFrame(animate);
	
	if (animationEnabled) {
		time += 0.01;
		
		// Subtle floating/bobbing motion for individual blocks
		carpet.children.forEach((block) => {
			if (block.userData.initialZ !== undefined) {
				block.position.z = block.userData.initialZ + Math.sin(time + block.userData.animationOffset) * 0.02;
				block.rotation.z = block.userData.initialRotationZ + Math.sin(time * 0.5 + block.userData.animationOffset) * 0.02;
			}
		});
		
		// Subtle overall rotation
		carpet.rotation.y = Math.sin(time * 0.1) * 0.05;
	}
	
	renderer.render(scene, camera);
}

// Handle window resize
window.addEventListener('resize', () => {
	const width = window.innerWidth;
	const height = window.innerHeight;
	renderer.setSize(width, height);
	camera.aspect = width / height;
	camera.updateProjectionMatrix();
});

// Export for OrbitControls to use
window.scene = scene;
window.camera = camera;
window.renderer = renderer;

// Initialize OrbitControls if available
let controls = null;
// Check for OrbitControls in different possible locations
const OrbitControlsClass = (typeof THREE !== 'undefined' && THREE.OrbitControls) 
	? THREE.OrbitControls 
	: (typeof OrbitControls !== 'undefined' ? OrbitControls : null);

if (OrbitControlsClass) {
	try {
		controls = new OrbitControlsClass(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.05;
		controls.minDistance = 10;
		controls.maxDistance = 50;
		controls.maxPolarAngle = Math.PI / 2; // Prevent going below floor
	} catch (e) {
		console.warn('OrbitControls initialization failed:', e);
	}
}

// Update animate function to include controls
const originalAnimate = animate;
function animateWithControls() {
	if (controls) {
		controls.update();
	}
	originalAnimate();
}

window.animate = animateWithControls;

// Start animation
animateWithControls();

