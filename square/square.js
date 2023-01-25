const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera( 75, window.innerWidth / window.innerHeight, 0.1, 1000 )
const renderer = new THREE.WebGLRenderer({ antialias: true})

renderer.setSize( window.innerWidth, window.innerHeight )
renderer.setClearColor("#222222")
document.body.appendChild( renderer.domElement )
camera.position.z = 20

const geometry = new THREE.PlaneGeometry( 3, 3 );
const material = new THREE.MeshBasicMaterial( {color: "turquoise", side: THREE.DoubleSide} );
const plane = new THREE.Mesh( geometry, material );
scene.add( plane );

function animate() {
	requestAnimationFrame(animate);
	plane.translateX(0.11);
	plane.translateY(0.12);
	renderer.render( scene, camera )
}

animate()

