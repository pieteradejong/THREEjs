////////////////////////////////////////////////////////////////////////////////
// Draw a Square Exercise                                                     //
// Your task is to complete the function square (at line 28).                 //
// The function takes 4 arguments - coordinates x1, y1, x2, y2                //
// for the square and returns a geometry object (THREE.Geometry())            //
// that defines a square at the provided coordinates.                         //
////////////////////////////////////////////////////////////////////////////////
/*global THREE Coordinates $ document window*/

var camera, scene, renderer;
var windowScale;

function drawSquare(x1, y1, x2, y2) {

	var square = new THREE.Geometry();
  console.log(square);
	square.vertices.push(new THREE.Vector3(x1,y1,0));
  square.vertices.push(new THREE.Vector3(x1,y2,0));
  square.vertices.push(new THREE.Vector3(x2,y1,0));
  square.vertices.push(new THREE.Vector3(x2,y2,0));
  
  square.faces.push(new THREE.Face3(0,1,2));
  square.faces.push(new THREE.Face3(1,2,3));
	return square;
}

function init() {
	//  Set up some parameters
	var canvasWidth = 824;
	var canvasHeight = 494;
	var canvasRatio = canvasWidth / canvasHeight;
	// scene
	scene = new THREE.Scene();

	// Camera: Y up, X right, Z up
	windowScale = 12;
	var windowWidth = windowScale * canvasRatio;
	var windowHeight = windowScale;

	camera = new THREE.OrthographicCamera(windowWidth/-2, windowWidth/2, windowHeight/2, windowHeight/-2, 0, 40);
	
	var focus = new THREE.Vector3( 5,5,0 );
	camera.position.x = focus.x;
	camera.position.y = focus.y;
	camera.position.z = 20;
	camera.lookAt(focus);

	renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true});
	renderer.gammaInput = true;
	renderer.gammaOutput = true;
	renderer.setSize( canvasWidth, canvasHeight );
	renderer.setClearColor( 0xffffff, 1.0 );
}
function addToDOM() {
    var container = document.getElementById('root');
    container.appendChild( renderer.domElement );
}
function render() {
	renderer.render( scene, camera );
}
function showGrids() {
	// Background grid and axes. Grid step size is 1, axes cross at 0, 0
	Coordinates.drawGrid({size:100,scale:1,orientation:"z"});
	Coordinates.drawAxes({axisLength:11,axisOrientation:"x",axisRadius:0.04});
	Coordinates.drawAxes({axisLength:11,axisOrientation:"y",axisRadius:0.04});
}

try {
  init();
  showGrids();
  var square_material = new THREE.MeshBasicMaterial( { color: 0xF6831E, side: THREE.DoubleSide } );
  var square_geometry = drawSquare(3,3,7,7);
  var square_mesh = new THREE.Mesh(square_geometry, square_material);
  scene.add(square_mesh);
  addToDOM();
  render();
} catch(e) {
    var errorReport = "Your program encountered an unrecoverable error, can not draw on canvas. Error was:<br/><br/>";
    $('#root').append(errorReport+e);
}

