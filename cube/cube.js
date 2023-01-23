const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 )
const renderer = new THREE.WebGLRenderer({ antialias: true})

renderer.setSize( window.innerWidth, window.innerHeight )
renderer.setClearColor("#222222")
document.body.appendChild( renderer.domElement )
camera.position.z = 20

window.addEventListener( 'resize', () => {
	let width = window.innerWidth
	let height = window.innerHeight
	renderer.setSize( width, height )
	camera.aspect = width / height
	camera.updateProjectionMatrix()
})

var geometry = new THREE.BoxGeometry(3,3,3)
var material = new THREE.MeshStandardMaterial({color: 0xff0051})
// var material = new THREE.MeshStandardMaterial({color: 0xfffde5})
var cube = new THREE.Mesh(geometry, material)
scene.add(cube)

var geometry = new THREE.BoxGeometry(6, 6, 6)
var material = new THREE.MeshBasicMaterial( {
	color: "#dadada", wireframe: true, transparent: true
})
var wireframeCube = new THREE.Mesh(geometry, material)
scene.add(wireframeCube)

// var ambientLight = new THREE.AmbientLight(0xffffff, 0.2)
var ambientLight = new THREE.AmbientLight(0xffffff, 0.4)
scene.add(ambientLight)

var pointLight = new THREE.PointLight(0xffffff, 1);
// var pointLight = new THREE.PointLight(0xffffff, 10.0);
pointLight.position.set(25, 50, 25);
scene.add(pointLight);


function animate() {
	requestAnimationFrame(animate);
	cube.rotation.x += 0.02;
	cube.rotation.y += 0.02;
	wireframeCube.rotation.x -= 0.005;
	wireframeCube.rotation.y -= 0.005;
	renderer.render( scene, camera )
}

animate()