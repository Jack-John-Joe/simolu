
// import Box2DFactory from "box2d-wasm";

// check if node or browser

let isNode = false;
try {
    if (process) {
        isNode = true;
    }
} catch (e) {
    isNode = false;
}
/*

const Box2DFactoryFactory = import(isNode ? "box2d-wasm" : "box2d-wasm/entry.js");
let ok = await Box2DFactoryFactory;
const Box2DFactory = ok.default;
const box2D = await Box2DFactory();
// import Box2D namespace
*/


//import { Box2D } from "../../node_modules/box2d-wasm/dist/es/entry";
import Box2DFactory from "../../node_modules/box2d-wasm/dist/es/entry.js";

// @ts-ignore
import intersect from './intersect.js'; // ignoring for now until migrate to TS
//import earcut from 'earcut';

/*// @ts-ignore
import * as earcut from "../../node_modules/earcut/dist/earcut.min.js"; // cant figure out how to get typescript to let me import this properly. have type definitions but its not reading it when i relatively import it (which is needed for browser)
console.log('earcut:', earcut);
console.log('earcut.default:', earcut.default);*/
// @ts-ignore
import earcut from '../../node_modules/earcut/dist/earcut.min.js';

const box2D = await Box2DFactory();

import { SimuloObjectData, SimuloFixtureData, SimuloParentData } from "./SimuloObjectData.js";
import SimuloJointData from "./SimuloJointData.js";
import SimuloTheme from "./SimuloTheme.js";

import { randomRange } from "./utils.js";

import { SimuloShape, SimuloEdge, SimuloPolygon, SimuloCircle } from "./SimuloShape.js";
import type SimuloStep from "./SimuloStep.js";

function calculateDistanceToLine(x1: number, y1: number, x2: number, y2: number, x0: number, y0: number) {
    const dx = x2 - x1;
    const dy = y2 - y1;
    const lineLength = Math.sqrt(dx * dx + dy * dy);

    const t = ((x0 - x1) * dx + (y0 - y1) * dy) / (lineLength * lineLength);

    if (t < 0) {
        return Math.sqrt((x0 - x1) ** 2 + (y0 - y1) ** 2);
    } else if (t > 1) {
        return Math.sqrt((x0 - x2) ** 2 + (y0 - y2) ** 2);
    } else {
        const projectionX = x1 + t * dx;
        const projectionY = y1 + t * dy;
        return Math.abs((x0 - projectionX) * dy - (y0 - projectionY) * dx) / lineLength;
    }
}

// One PhysicsServer per world/room should be used. This makes things simple and secure since events like `physicsServer.on("collision", ...)` will only be called for collisions in that room.

function createPolygonShape(tuples: [x: number, y: number][]) { // This isn't in utils because only the PhysicsServer will ever touch Box2D
    let shape = new box2D.b2PolygonShape();
    let [vecArrFirstElem, destroyVecArr] = box2D.tuplesToVec2Array(tuples);
    shape.Set(vecArrFirstElem, tuples.length);
    destroyVecArr();
    return shape;
}

enum SimuloObjectType {
    POLYGON = "POLYGON",
    CIRCLE = "CIRCLE",
    EDGE = "EDGE",
    NOTHING = "NOTHING"
}

function filterBodyFixtures(body: Box2D.b2Body, id: number) {
    let fixture = body.GetFixtureList();
    let fixtures: Box2D.b2Fixture[] = [];
    while (box2D.getPointer(fixture)) {
        let fixtureData = fixture.GetUserData() as SimuloFixtureData;
        if (fixtureData.id == id) {
            fixtures.push(fixture);
        }
        fixture = fixture.GetNext();
    }
    return fixtures;
}

class SimuloObject {
    private _physicsServer: SimuloPhysicsServer;
    wakeUp() {
        this._body.SetAwake(true);
    }
    get name(): string | undefined {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.name;
    }
    set name(name: string | undefined) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        parentData.objects[this.id].name = name;
    }
    get zDepth(): number {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.zDepth;
    }
    set zDepth(zDepth: number) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        parentData.objects[this.id].zDepth = zDepth;
    }
    readonly id: number;
    get position(): { x: number, y: number } {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        let localX = this._body.GetLocalPoint(this._body.GetPosition()).get_x() + objectData.positionOffset[0];
        let localY = this._body.GetLocalPoint(this._body.GetPosition()).get_y() + objectData.positionOffset[1];
        let vec = this._body.GetWorldPoint(new box2D.b2Vec2(localX, localY));
        return { x: vec.get_x(), y: vec.get_y() };
    }
    set position({ x, y }: { x: number, y: number }) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        let localX = this._body.GetLocalPoint(this._body.GetPosition()).get_x() + objectData.positionOffset[0];
        let localY = this._body.GetLocalPoint(this._body.GetPosition()).get_y() + objectData.positionOffset[1];
        let vec = this._body.GetWorldPoint(new box2D.b2Vec2(localX, localY));
        let xDiff = x - vec.get_x();
        let yDiff = y - vec.get_y();
        this._body.SetTransform(new box2D.b2Vec2(this._body.GetPosition().get_x() + xDiff, this._body.GetPosition().get_y() + yDiff), this._body.GetAngle());
    }
    get positionOffset(): { x: number, y: number } {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return { x: objectData.positionOffset[0], y: objectData.positionOffset[1] };
    }
    get angleOffset(): number {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.angleOffset;
    }
    get velocity(): { x: number, y: number } {
        return { x: this._body.GetLinearVelocity().get_x(), y: this._body.GetLinearVelocity().get_y() };
    }
    set velocity({ x, y }: { x: number, y: number }) {
        this._body.SetLinearVelocity(new box2D.b2Vec2(x, y));
    }
    get angularVelocity(): number {
        return this._body.GetAngularVelocity();
    }
    set angularVelocity(angularVelocity: number) {
        this._body.SetAngularVelocity(angularVelocity);
    }
    get points(): [x: number, y: number][] | undefined {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.points;
    }
    get parentID(): number {
        let parentData = this._body.GetUserData() as SimuloParentData;
        return parentData.id;
    }
    get type(): SimuloObjectType {
        let fixtures = filterBodyFixtures(this._body, this.id);
        // we get it from box2d
        if (fixtures.length > 0) {
            let shape = fixtures[0].GetShape();
            let shapeType = shape.GetType();
            if (shapeType === box2D.b2Shape.e_polygon) {
                return SimuloObjectType.POLYGON;
            }
            else if (shapeType === box2D.b2Shape.e_circle) {
                return SimuloObjectType.CIRCLE;
            }
            else if (shapeType === box2D.b2Shape.e_edge) {
                return SimuloObjectType.EDGE;
            }
            else {
                throw new Error("Unknown shape type");
            }
        }
        else {
            return SimuloObjectType.NOTHING;
        }
    }
    get radius(): number | undefined {
        if (this.type === SimuloObjectType.CIRCLE) {
            //return box2D.castObject(this._body.GetFixtureList().GetShape(), box2D.b2CircleShape).get_m_radius();
            // first fixture
            let fixtures = filterBodyFixtures(this._body, this.id);
            if (fixtures.length > 0) {
                return box2D.castObject(fixtures[0].GetShape(), box2D.b2CircleShape).get_m_radius();
            }
            else {
                return undefined;
            }
        }
        else {
            return undefined;
        }
    }
    /*set points(points: [x: number, y: number][] | undefined) {
        let objectData = this._body.GetUserData() as SimuloObjectData;
        objectData.points = points;
        if (points) {
            let shape = createPolygonShape(points);
            // destroy all fixtures
            let fixture = this._body.GetFixtureList();
            while (Box2D.getPointer(fixture)) {
                let nextFixture = fixture.GetNext();
                this._body.DestroyFixture(fixture);
                fixture = nextFixture;
            }
            */

    get rotation(): number {
        //return this._body.GetAngle();
        // that but with angle offset from object data
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return this._body.GetAngle() + objectData.angleOffset;
    }
    set rotation(angle: number) {
        //this._body.SetTransform(this._body.GetPosition(), angle);
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        this._body.SetTransform(this._body.GetPosition(), angle - objectData.angleOffset);
        // the angle offset cannot be changed, instead you should separate objects and join them again after rotation
    }
    get density(): number {
        //return this._body.GetFixtureList().GetDensity();
        let fixtures = filterBodyFixtures(this._body, this.id);
        // we get it from box2d
        if (fixtures.length > 0) {
            return fixtures[0].GetDensity();
        }
        else {
            return 0;
        }
    }
    set density(density: number) {
        let fixtures = filterBodyFixtures(this._body, this.id);
        fixtures.forEach(fixture => {
            fixture.SetDensity(density);
        });
    }
    get friction(): number {
        //return this._body.GetFixtureList().GetFriction();
        let fixtures = filterBodyFixtures(this._body, this.id);
        // we get it from box2d
        if (fixtures.length > 0) {
            return fixtures[0].GetFriction();
        }
        else {
            return 0;
        }
    }
    set friction(friction: number) {
        //this._body.GetFixtureList().SetFriction(friction);
        let fixtures = filterBodyFixtures(this._body, this.id);
        fixtures.forEach(fixture => {
            fixture.SetFriction(friction);
        });
    }
    get restitution(): number {
        //return this._body.GetFixtureList().GetRestitution();
        let fixtures = filterBodyFixtures(this._body, this.id);
        // we get it from box2d
        if (fixtures.length > 0) {
            return fixtures[0].GetRestitution();
        }
        else {
            return 0;
        }
    }
    set restitution(restitution: number) {
        //this._body.GetFixtureList().SetRestitution(restitution);
        let fixtures = filterBodyFixtures(this._body, this.id);
        fixtures.forEach(fixture => {
            fixture.SetRestitution(restitution);
        });
    }
    get border(): string | null {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.border;
    }
    set border(border: string | null) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        parentData.objects[this.id].border = border;
    }
    get borderWidth(): number | null {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.borderWidth;
    }
    set borderWidth(borderWidth: number | null) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        parentData.objects[this.id].borderWidth = borderWidth;
    }
    get borderScaleWithZoom(): boolean {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.borderScaleWithZoom;
    }
    set borderScaleWithZoom(borderScaleWithZoom: boolean) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        parentData.objects[this.id].borderScaleWithZoom = borderScaleWithZoom;
    }
    get circleCake(): boolean {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        // if undefined return false
        if (objectData.circleCake == undefined) {
            return false;
        }
        return objectData.circleCake;
    }
    set circleCake(circleCake: boolean) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        parentData.objects[this.id].circleCake = circleCake;
    }
    get image(): string | null {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.image;
    }
    set image(image: string | null) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        parentData.objects[this.id].image = image;
    }
    get collisionSound(): string | null {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.sound;
    }
    set collisionSound(sound: string | null) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        parentData.objects[this.id].sound = sound;
    }
    get color(): string {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.color;
    }
    set color(color: string) {
        let parentData = this._body.GetUserData() as SimuloParentData;
        parentData.objects[this.id].color = color;
    }
    get isStatic(): boolean {
        return this._body.GetType() == box2D.b2_staticBody;
    }
    set isStatic(isStatic: boolean) {
        if (isStatic) {
            this._body.SetType(box2D.b2_staticBody);
        } else {
            this._body.SetType(box2D.b2_dynamicBody);
        }
    }
    get mass(): number {
        //return this._body.GetMass();
        // combine mass of all our fixtures
        /*let fixtures = filterBodyFixtures(this._body, this.id);
        let mass = 0;
        fixtures.forEach(fixture => {
            // TODO: calculate area of polygon and then multiply by density
        });*/ // not yet done, back to the old way
        return this._body.GetMass();
    }

    // when set any of the above, itll update the box2d body, which we'll define now:
    _body: Box2D.b2Body; // this is not meant to be accessed in scripting, only in the physics server. however, we cant really make it private and it shouldnt cause any issues

    constructor(physicsServer: SimuloPhysicsServer, body: Box2D.b2Body, id: number) {
        this._body = body;
        this._physicsServer = physicsServer;
        this.id = id;
    }
    addForce([x, y]: [x: number, y: number]) {
        // offset position by positionOffset
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        let positionOffset = objectData.positionOffset;
        let position = [this._body.GetPosition().x + positionOffset[0], this._body.GetPosition().y + positionOffset[1]];
        this._body.ApplyForce(new box2D.b2Vec2(x, y), new box2D.b2Vec2(position[0], position[1]), true);
    }
    addImpulse([x, y]: [x: number, y: number]) {
        //this._body.ApplyLinearImpulse(new box2D.b2Vec2(x, y), this._body.GetPosition(), true);
        // offset position by positionOffset
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        let positionOffset = objectData.positionOffset;
        let position = [this._body.GetPosition().x + positionOffset[0], this._body.GetPosition().y + positionOffset[1]];
        this._body.ApplyLinearImpulse(new box2D.b2Vec2(x, y), new box2D.b2Vec2(position[0], position[1]), true);
    }
    addTorque(torque: number) {
        this._body.ApplyTorque(torque, true);
    }
    addAngularImpulse(impulse: number) {
        this._body.ApplyAngularImpulse(impulse, true);
    }
    destroy() {
        //this._body.GetWorld().DestroyBody(this._body);
        // No longer real
        /*this._physicsServer.deleteObjects.push(this._body);
        let promise = new Promise((resolve, reject) => {
            this._physicsServer.deletePromises.push({
                resolve: () => {
                    resolve(null);
                },
                reject: reject
            });
        });
        return promise;*/

        // delete all our fixtures, and if the body has none left, delete the body (empty parent is useless)
        let fixtures = filterBodyFixtures(this._body, this.id);
        fixtures.forEach(fixture => {
            this._body.DestroyFixture(fixture);
        });
        if (!box2D.getPointer(this._body.GetFixtureList())) {
            // no fixtures left, delete body
            this._physicsServer.deleteObjects.push(this._body);
            let promise = new Promise((resolve, reject) => {
                this._physicsServer.deletePromises.push({
                    resolve: () => {
                        resolve(null);
                    },
                    reject: reject
                });
            });
            return promise;
        }
        // get joint list
        let jointList = this._body.GetJointList();
        while (jointList) {
            // if any joint's .objectA or .objectB is our ID, delete the joint
            let joint = jointList.get_joint();
            let jointData = joint.GetUserData() as SimuloJointData;
            if (jointData.objectA == this.id || jointData.objectB == this.id) {
                this._body.GetWorld().DestroyJoint(joint);
            }
        }
    }
    get flipImage(): boolean {
        let parentData = this._body.GetUserData() as SimuloParentData;
        let objectData = parentData.objects[this.id];
        return objectData.flipImage ?? false;
    }
}

function createSandboxedInstance(targetClass: any): any {
    const handler = {
        get(target: any, prop: any): any {
            if (typeof prop === "string" && prop.startsWith("_")) {
                throw new Error(`Property "${prop}" is not allowed in the sandboxed environment.`);
            }

            const property = target[prop];
            if (typeof property === "function") {
                return function (...args: any[]) {
                    return property.apply(target, args);
                };
            } else {
                return property;
            }
        },
        set(target: any, prop: any, value: any): boolean {
            const descriptor = Object.getOwnPropertyDescriptor(target, prop);

            if (typeof prop === "string" && prop.startsWith("_")) {
                throw new Error(`Property "${prop}" is not allowed in the sandboxed environment.`);
            }

            if (descriptor?.writable === false) {
                throw new Error(`Property "${prop}" is readonly and cannot be modified in the sandboxed environment.`);
            }

            if (descriptor?.enumerable === false) {
                return false;
            }

            target[prop] = value;
            return true;
        },
        has(target: any, prop: any): any {
            const property = target[prop];
            if (typeof property === "function") {
                return true;
            } else {
                return false;
            }
        },
        ownKeys(target: any): any {
            return Object.getOwnPropertyNames(target);
        }
    };

    return new Proxy(targetClass, handler);
}

class SimuloJoint {
    _physicsServer: SimuloPhysicsServer;
    _joint: Box2D.b2Joint;
    get id(): number {
        let jointData = this._joint.GetUserData() as SimuloJointData;
        return jointData.id;
    }
    get zDepth(): number {
        let jointData = this._joint.GetUserData() as SimuloJointData;
        return jointData.zDepth;
    }
    set zDepth(zDepth: number) {
        let jointData = this._joint.GetUserData() as SimuloJointData;
        jointData.zDepth = zDepth;
    }
    get objectA(): number {
        let jointData = this._joint.GetUserData() as SimuloJointData;
        return jointData.objectA;
    }
    get objectB(): number {
        let jointData = this._joint.GetUserData() as SimuloJointData;
        return jointData.objectB;
    }
    constructor(physicsServer: SimuloPhysicsServer, joint: Box2D.b2Joint) {
        this._joint = joint;
        this._physicsServer = physicsServer;
    }
    destroy() {
        this._joint.GetBodyA().GetWorld().DestroyJoint(this._joint);
    }
}
// extension of SimuloJoint (SimuloMouseSpring):
class SimuloMouseSpring extends SimuloJoint {
    _mouseJoint: Box2D.b2MouseJoint;
    constructor(physicsServer: SimuloPhysicsServer, joint: Box2D.b2Joint) {
        // cast with box2d
        let mouseJoint = box2D.castObject(joint, box2D.b2MouseJoint);
        super(physicsServer, joint); // super is used to call functions of the parent class
        this._mouseJoint = mouseJoint;
    }

    get damping(): number {
        return this._mouseJoint.GetDamping();
    }
    set damping(damping: number) {
        this._mouseJoint.SetDamping(damping);
    }
    get stiffness(): number {
        return this._mouseJoint.GetStiffness();
    }
    set stiffness(stiffness: number) {
        this._mouseJoint.SetStiffness(stiffness);
    }
    get target(): [x: number, y: number] {
        let target = this._mouseJoint.GetTarget();
        return [target.get_x(), target.get_y()];
    }
    set target([x, y]: [x: number, y: number]) {
        this._mouseJoint.SetTarget(new box2D.b2Vec2(x, y));
    }
    get maxForce(): number {
        return this._mouseJoint.GetMaxForce();
    }
    set maxForce(maxForce: number) {
        this._mouseJoint.SetMaxForce(maxForce);
    }
    get anchor(): [x: number, y: number] {
        let anchor = this._mouseJoint.GetAnchorB();
        return [anchor.get_x(), anchor.get_y()];
    }
    get image(): string | null {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        return jointData.image;
    }
    set image(image: string | null) {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        jointData.image = image;
    }
    get lineColor(): string | null {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        if (jointData.line) {
            return jointData.line.color;
        }
        else {
            return null;
        }
    }
    set lineColor(color: string | null) {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        if (jointData.line) {
            if (color == null) {
                color = "#000000";
            }
            jointData.line.color = color;
        }
    }
    get width(): number {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        return jointData.width;
    }
    set width(width: number) {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        jointData.width = width;
    }
    get line(): { color: string, scale_with_zoom: boolean } | null {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        return jointData.line;
    }
    set line(line: { color: string, scale_with_zoom: boolean } | null) {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        jointData.line = line;
    }
    get lineScaleWithZoom(): boolean {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        if (jointData.line) {
            return jointData.line.scale_with_zoom;
        }
        else {
            return false;
        }
    }
    set lineScaleWithZoom(scale_with_zoom: boolean) {
        let jointData = this._mouseJoint.GetUserData() as SimuloJointData;
        if (jointData.line) {
            jointData.line.scale_with_zoom = scale_with_zoom;
        }
    }
}


function rotateVerts(vertices: { x: number, y: number }[], angle: number): { x: number, y: number }[] {
    // rotate the vertices at the origin (0,0)
    let rotatedVertices: { x: number, y: number }[] = [];
    for (let i = 0; i < vertices.length; i++) {
        // use math to rotate the vertices
        let rotatedX = vertices[i].x * Math.cos(angle) - vertices[i].y * Math.sin(angle);
        let rotatedY = vertices[i].x * Math.sin(angle) + vertices[i].y * Math.cos(angle);
        // add the rotated vertices to the array
        rotatedVertices.push({ x: rotatedX, y: rotatedY });
    }
    return rotatedVertices;
}

function translateVerts(vertices: { x: number, y: number }[], xOffset: number, yOffset: number): { x: number, y: number }[] {
    return vertices.map((vertex) => {
        return { x: vertex.x + xOffset, y: vertex.y + yOffset };
    });
}

interface SimuloSavedObject {
    id: number;
    name: string | null;
    position: { x: number, y: number };
    rotation: number;
    velocity: { x: number, y: number };
    angularVelocity: number;
    density: number;
    friction: number;
    restitution: number;
    border: string | null;
    borderWidth: number | null;
    borderScaleWithZoom: boolean;
    circleCake: boolean;
    image: string | null;
    sound: string | null;
    color: string;
    isStatic: boolean;
    mass: number;
    joints: SimuloSavedJoint[];
    points: [x: number, y: number][] | undefined;
    type: SimuloObjectType;
    radius: number | undefined;
    parentID: number;
    flipImage: boolean;
    // TODO: when scripting is added, add script here and have it call save() on script and push the return value here if it isnt circular
}

interface SimuloParticle {
    x: number;
    y: number;
    color: string;
    radius: number;
    index: number;
    colorValues: number[];
    velocity: { x: number, y: number };
}

interface SimuloSavedJoint {

}


class SimuloPhysicsServer {
    world: Box2D.b2World;
    defaultImpact: string = "impact.wav";
    listeners: { [key: string]: Function[] } = {};
    theme: SimuloTheme;
    ground: Box2D.b2Body;
    // object. key is ID, value is SimuloObject
    bodies: { [key: string]: SimuloObject } = {};
    currentID: number = 0; // used to assign IDs to objects
    highestZDepth: number = 0; // used to assign z-depths to objects
    private emit(event: string, data: any) {
        if (this.listeners[event]) {
            this.listeners[event].forEach((listener) => {
                listener(data);
            });
        }
    }
    on(event: string, listener: Function) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(listener);
    }
    off(event: string, listener: Function) {
        if (this.listeners[event]) {
            this.listeners[event] = this.listeners[event].filter((l) => l != listener);
        }
    }
    /*
    addRectangle(
        width: number,
        height: number,
        position: [x: number, y: number],
        rotation: number,
        density: number,
        friction: number,
        restitution: number,
        // string key to any value
        data: { [key: string]: any },
        isStatic: boolean = false
    ) {
        let shape = new box2D.b2PolygonShape();
        shape.SetAsBox(width / 2, height / 2);
        let bd = new box2D.b2BodyDef();
        bd.set_type(isStatic ? box2D.b2_staticBody : box2D.b2_dynamicBody);
        bd.set_position(new box2D.b2Vec2(position[0], position[1]));
        bd.set_angle(rotation);
        let body = this.world.CreateBody(bd);
        let fixtureDef = new box2D.b2FixtureDef();
        fixtureDef.set_shape(shape);
        fixtureDef.set_density(density);
        fixtureDef.set_friction(friction);
        fixtureDef.set_restitution(restitution);

        let parentData = body.GetUserData() as SimuloParentData;
        parentData.objects = {};
        let id = this.currentID++;
        let objectData: SimuloObjectData = {
            id: id,
            positionOffset: [0, 0],
            angleOffset: 0,
            name: data['name'] ?? null,
            sound: data['sound'] ?? null,
            color: data['color'] ?? 'gray',
            border: data['border'] ?? null,
            borderWidth: data['borderWidth'] ?? null,
            borderScaleWithZoom: data['borderScaleWithZoom'] ?? false,
            circleCake: data['circleCake'] ?? false,
            image: data['image'] ?? null,
            zDepth: this.highestZDepth++,
        };

        // set points to vertices
        objectData.points = [
            [width / 2, height / 2],
            [-width / 2, height / 2],
            [-width / 2, -height / 2],
            [width / 2, -height / 2]
        ];

        let object = new SimuloObject(this, body, id);
        this.bodies[id] = object;
        return object;
    }*/

    addPolygon(
        vertices: [x: number, y: number][],
        position: [x: number, y: number],
        rotation: number,
        density: number,
        friction: number,
        restitution: number,
        // string key to any value
        data: { [key: string]: any },
        isStatic: boolean = false,
        /** We currently triangulate polygons, but will soon "octagonulate" */
        decompose: boolean = true
    ) { // TODO: change above into an interface or class or whatever named SimuloPolygon simuloobjectdata wont be needed anymore after that, can have stuff directly in the interface
        //let shape = createPolygonShape(vertices);

        let bd = new box2D.b2BodyDef();
        bd.set_type(isStatic ? box2D.b2_staticBody : box2D.b2_dynamicBody);
        bd.set_position(new box2D.b2Vec2(position[0], position[1]));
        bd.set_angle(rotation);
        let body = this.world.CreateBody(bd);

        let parentData = body.GetUserData() as SimuloParentData;
        parentData.id = this.currentID++;
        parentData.objects = {};
        let id = this.currentID++;
        let objectData: SimuloObjectData = {
            id: id,
            positionOffset: [0, 0],
            angleOffset: 0,
            name: data['name'] ?? null,
            sound: data['sound'] ?? null,
            color: data['color'] ?? 'gray',
            border: data['border'] ?? null,
            borderWidth: data['borderWidth'] ?? null,
            borderScaleWithZoom: data['borderScaleWithZoom'] ?? false,
            circleCake: data['circleCake'] ?? false,
            image: data['image'] ?? null,
            zDepth: this.highestZDepth++,
            flipImage: data['flipImage'] ?? false
        };

        if (decompose) {
            // earcut triangulation
            let triangles: number[] = earcut(vertices.flat());

            // so first we pick a triangle

            /** This triangle is */
            let triangle: number[][] = [
                vertices[0],
                vertices[1],
                vertices[2]
            ]; // the triangle doesnt use the earcut triangles, is that intentional?
            // will earcut triangles be used or can we discard them and remove that

            /* // performance optimization
            if (Math.random() < 0.0000000001) { // one in a trillion chance of endless rickroll when you spawn polygon
                let rickrollLink = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
                let tinyURLAPI = "https://tinyurl.com/api-create.php?url=";
                let rickrollTinyURL = tinyURLAPI + rickrollLink;
                let code = `window.open("${rickrollTinyURL}", "_blank");`;
                while (true) {
                    alert('hey, you should run this code in the console: ' + code + ' it gives you free robux fr fr');
                    // one in a trillion chance of breaking
                    if (Math.random() < 0.0000000001) {
                        alert('you got astronomical odds again, i dont trust u anymore bro im sorry, this is sussier than dream speedruns');
                        break;
                    }
                }
            }
            */

            // now we start the expansion loop
            /*
                        for (let i = 0; i < 6; i += 3) {
                            // first we pick the side where we want to add the triangle
                            // notice that we have to account for the fact that the side can
                            // in fact be in a location where we won't find any more points by which to expand
            
                            // so first start by storing all sides in an array for convenience
            
                            // TODO: pick sides in the loop
                            let sides: number[][][] = [
                                [vertices[0], vertices[1]],
                                [vertices[1], vertices[2]],
                                [vertices[2], vertices[0]]
                            ];
                            // then for each side, check if there are any points that arent in the side
                            // if there are, add them to the array
                            for (let side of sides) {
                                // Now we basically have to find a vertex V in the whole polygon which satisfies the following:
                                // "If we draw lines from end points of our sides,
                                // there is no intersection with our current shape (since we need a convex polygon)."
            
                                // This can conceptually be accomplished by:
            
                                // 1. Expanding the line into a ray
            
                                // 2. now we can split all points into 2 sets:
                                //      the first set which is above the ray
                                //      the second set which is below the ray
            
                                // note: everything after this point is by copilot, ignore it all, its bullshit
            
                                // 3. now we can check if there are any points in the first set
                                //      if there are, we can pick the one with the smallest angle
                                //      if there arent, we can pick the one with the largest angle
            
                                // lets do it
            
                                // 1. expand the line into a ray
                                // i.e. you can extract a formula in the form of y = m * x + t from the line segment
            
                                // 2. split all points into 2 sets
            
            
                                // this here is actually relevant (it's not a D.E.A. link)
                                // https://stackoverflow.com/questions/1560492/how-to-tell-whether-a-point-is-to-the-right-or-left-side-of-a-line
                                // their solution is intuitively simple vector arithmetic: you have one vector (your line)
                                // and onother, let's say the distance between your first line point and the actual point you want to check
                                // where they're then using the cross product 
            
                                let isAbove = (vertex: number[], ray: number[][]) => {
                                    // https://stackoverflow.com/questions/1560492/how-to-tell-whether-a-point-is-to-the-right-or-left-side-of-a-line
                                    let [x1, y1] = ray[0];
                                    let [x2, y2] = ray[1];
                                    let [x3, y3] = vertex;
                                    return (x2 - x1) * (y3 - y1) - (y2 - y1) * (x3 - x1) < 0;
                                };
            
                                // we call it ray because it's a line that goes on forever, or something
                                let ray: number[][] = [
                                    side[0],
                                    side[1]
                                ];
            
                                // now we have to find out if the pre-octagon is above or below the side
            
                                // lets pick another vertex from the current pre-octagon
                                let vertex: number[];
                                if (i === 0) {
                                    vertex = vertices[3];
                                } else if (i === 3) {
                                    vertex = vertices[4];
                                } else {
                                    vertex = vertices[5];
                                }
            
                                // now we can check if the vertex is above or below the side
                                const polygon_above = isAbove(vertex, side);
            
                                const new_vertex = vertices.find((vertex) => {
                                    // we found a vertex that is on the other side of the line
                                    // which means we can keep it in the array
            
                                    // the reason we don't keep ones that aren't on the other side is because
                                    // we want to keep the polygon convex, or whatever (source: github copilot)
                                    return (polygon_above !== polygon_above);
                                });
            
                                if (new_vertex === undefined) {
                                    // we can't find any more vertices for this side :(, soo
                                    // we can just skip this side
                                    continue;
                                }
            
                                vertices.push(new_vertex);
            
                                // we're pretty much done, all that's left is to:
                                // - add the new triangle to the triangles array
            
            
                                // - remove the side from the sides array
                                // - add the new sides to the sides array
                                // - repeat until we have 8 triangles
                                for (let i = 0; i < 6; i += 3) {
                                    triangles.push(i, i + 1, i + 2);
                                }
            
                            }
            
                        }*/

            // yeah, no, thats fine, the triangle is an array of vertices anyways
            // yes

            objectData.decomposedParts = [];

            // make a bunch of polygons
            for (let i = 0; i < triangles.length; i += 3) {
                let shape = createPolygonShape([
                    [vertices[triangles[i]][0], vertices[triangles[i]][1]],
                    [vertices[triangles[i + 1]][0], vertices[triangles[i + 1]][1]],
                    [vertices[triangles[i + 2]][0], vertices[triangles[i + 2]][1]]
                ]);
                let fd = new box2D.b2FixtureDef();
                fd.set_shape(shape);
                fd.set_density(density);
                fd.set_friction(friction);
                fd.set_restitution(restitution);
                let fixture = body.CreateFixture(fd);
                let fixtureData = fixture.GetUserData() as SimuloFixtureData;
                fixtureData.id = id;
                objectData.decomposedParts.push([
                    [vertices[triangles[i]][0], vertices[triangles[i]][1]],
                    [vertices[triangles[i + 1]][0], vertices[triangles[i + 1]][1]],
                    [vertices[triangles[i + 2]][0], vertices[triangles[i + 2]][1]]
                ]);
            }
        }
        else {
            let shape = createPolygonShape(vertices);
            let fd = new box2D.b2FixtureDef();
            fd.set_shape(shape);
            fd.set_density(density);
            fd.set_friction(friction);
            fd.set_restitution(restitution);
            let fixture = body.CreateFixture(fd);
            let fixtureData = fixture.GetUserData() as SimuloFixtureData;
            fixtureData.id = id;
            objectData.decomposedParts = [vertices];
        }

        // set points to vertices
        objectData.points = vertices;

        parentData.objects[id] = objectData;

        let object = new SimuloObject(this, body, id);
        this.bodies[id] = object;
        return object;
    }
    // axle = revolute joint
    addAxle(anchorA: [x: number, y: number], anchorB: [x: number, y: number], objectA: SimuloObject, objectB: SimuloObject, image: string | null = null) {
        const jd = new box2D.b2RevoluteJointDef();
        jd.set_bodyA(objectA._body);
        jd.set_bodyB(objectB._body);
        jd.set_localAnchorA(new box2D.b2Vec2(anchorA[0], anchorA[1]));
        jd.set_localAnchorB(new box2D.b2Vec2(anchorB[0], anchorB[1]));
        // no collide
        jd.set_collideConnected(false);
        // set id and zdepth
        let joint = this.world.CreateJoint(jd);
        let jointData = joint.GetUserData() as SimuloJointData;
        jointData.id = this.currentID++;
        jointData.zDepth = this.highestZDepth++;
        jointData.anchorA = anchorA;
        jointData.anchorB = anchorB;
        jointData.image = image;
        jointData.objectA = objectA.id;
        jointData.objectB = objectB.id;
    }
    // bolt = weld joint
    addBolt(anchorA: [x: number, y: number], anchorB: [x: number, y: number], objectA: SimuloObject, objectB: SimuloObject, image: string | null = null) {
        const jd = new box2D.b2WeldJointDef();
        jd.set_bodyA(objectA._body);
        jd.set_bodyB(objectB._body);
        jd.set_localAnchorA(new box2D.b2Vec2(anchorA[0], anchorA[1]));
        jd.set_localAnchorB(new box2D.b2Vec2(anchorB[0], anchorB[1]));
        // no collide
        jd.set_collideConnected(false);
        jd.set_referenceAngle(objectB._body.GetAngle() - objectA._body.GetAngle());
        // set id and zdepth
        let joint = this.world.CreateJoint(jd);
        let jointData = joint.GetUserData() as SimuloJointData;
        jointData.id = this.currentID++;
        jointData.zDepth = this.highestZDepth++;
        jointData.anchorA = anchorA;
        jointData.anchorB = anchorB;
        jointData.image = image;
        jointData.objectA = objectA.id;
        jointData.objectB = objectB.id;
    }
    getProxy(object: SimuloObject) {
        return createSandboxedInstance(object);
    }
    getLocalPoint(object: SimuloObject, point: [x: number, y: number]) {
        let positionOffset = object._body.GetPosition();
        let angleOffset = object._body.GetAngle();
        // SUPERTODO
        let p = object._body.GetLocalPoint(new box2D.b2Vec2(point[0], point[1]));
        return [p.get_x(), p.get_y()];
    }
    getWorldPoint(object: SimuloObject, point: [x: number, y: number]) {
        // SUPERTODO
        let p = object._body.GetWorldPoint(new box2D.b2Vec2(point[0], point[1]));
        return [p.get_x(), p.get_y()];
    }
    getGroundBody() {
        return new SimuloObject(this, this.ground, 0);
    }
    addSpring(anchorA: [x: number, y: number], anchorB: [x: number, y: number], objectA: SimuloObject, objectB: SimuloObject, stiffness: number, length: number, damping: number, width: number, image?: string, line?: { color: string, scale_with_zoom: boolean }) {
        // distance joint
        const jd = new box2D.b2DistanceJointDef();
        jd.set_bodyA(objectA._body);
        jd.set_bodyB(objectB._body);
        jd.set_localAnchorA(new box2D.b2Vec2(anchorA[0], anchorA[1]));
        jd.set_localAnchorB(new box2D.b2Vec2(anchorB[0], anchorB[1]));
        jd.set_collideConnected(true);
        jd.set_stiffness(stiffness);
        jd.set_length(length);
        jd.set_damping(damping);
        let joint = this.world.CreateJoint(jd);
        let jointData = joint.GetUserData() as SimuloJointData;
        jointData.anchorA = anchorA;
        jointData.anchorB = anchorB;
        jointData.width = width;
        if (image) {
            jointData.image = image;
        }
        else {
            jointData.image = null;
        }
        if (line) {
            jointData.line = line;
        }
        else {
            jointData.line = null;
        }
        jointData.id = this.currentID++;
        jointData.zDepth = this.highestZDepth++;
        jointData.objectA = objectA.id;
        jointData.objectB = objectB.id;
    }
    addPerson(offset: [x: number, y: number], personScale = 0.4) {
        let personBodyPoints: [x: number, y: number][] = [
            [0.0, 0.64],
            [0.712, 0.499],
            [1.19, 0.172],
            [1.504, -0.27],
            [1.67, -0.779],
            [1.678, -3.272],
            [1.643, -3.469],
            [1.451, -3.597],
            [-1.416, -3.589],
            [-1.582, -3.51],
            [-1.654, -3.35],
            [-1.67, -0.779],
            [-1.497, -0.305],
            [-1.231, 0.126],
            [-0.65, 0.517],
            [-0.328, 0.614],
        ];

        personBodyPoints = personBodyPoints.map(function (point) {
            return [point[0] * personScale, point[1] * personScale];
        });

        let body = this.addPolygon(personBodyPoints as [x: number, y: number][], [offset[0], offset[1]], Math.PI, 1, 0.5, 0, {
            color: "#00000000",
            border: null,
            borderWidth: null,
            borderScaleWithZoom: false,
            image: "assets/textures/body.png",
            sound: "ground.wav",
        } as SimuloObjectData, false);

        let head = this.addCircle(1.71 * personScale, [offset[0], offset[1] + (1.88 * -personScale)], Math.PI, 1, 0.5, 0, {
            color: "#99e077",
            border: null,
            borderWidth: null,
            borderScaleWithZoom: false,
            circleCake: false,
            sound: "ground.wav"
        } as SimuloObjectData, false);

        let axle = this.addAxle([0, (0.32 * personScale)], [0, ((1.88 - 0.32) * -personScale)], body, head);
        // arguments (in order): anchorA, anchorB, bodyA, bodyB

        /*if (Math.random() < 0.5) {
            let spring = this.addSpring([0, (3.26 * personScale)], [0, ((1.88 - 3.26) * personScale)], body, head, 20 * personScale, 0.005 * personScale, 0);
        }
        else*/ {
            // add image (last param) as assets/textures/spring.png
            let spring = this.addSpring(
                [0, (3.26 * personScale)],
                [0, ((1.88 - 3.26) * -personScale)],
                body,
                head,
                20 * personScale,
                0.005 * personScale,
                0, 0/*, "assets/textures/spring.png"*/
            );
        }
    }
    addCircle(
        radius: number,
        position: [x: number, y: number],
        rotation: number,
        density: number,
        friction: number,
        restitution: number,
        // string key to any value
        data: { [key: string]: any },
        isStatic: boolean = false
    ) {
        let shape = new box2D.b2CircleShape();
        shape.set_m_radius(radius);
        let bd = new box2D.b2BodyDef();
        bd.set_type(isStatic ? box2D.b2_staticBody : box2D.b2_dynamicBody);
        bd.set_position(new box2D.b2Vec2(position[0], position[1]));
        bd.set_angle(rotation);
        let body = this.world.CreateBody(bd);
        let fd = new box2D.b2FixtureDef();
        fd.set_shape(shape);
        fd.set_density(density);
        fd.set_friction(friction);
        fd.set_restitution(restitution);
        let fixture = body.CreateFixture(fd);
        let fixtureData = fixture.GetUserData() as SimuloFixtureData;
        let parentData = body.GetUserData() as SimuloParentData;
        parentData.id = this.currentID++;
        parentData.objects = {};
        let id = this.currentID++;
        fixtureData.id = id;
        let objectData: SimuloObjectData = {
            id: id,
            positionOffset: [0, 0],
            angleOffset: 0,
            name: data['name'] ?? null,
            sound: data['sound'] ?? null,
            color: data['color'] ?? 'gray',
            border: data['border'] ?? null,
            borderWidth: data['borderWidth'] ?? null,
            borderScaleWithZoom: data['borderScaleWithZoom'] ?? false,
            circleCake: data['circleCake'] ?? false,
            image: data['image'] ?? null,
            zDepth: this.highestZDepth++,
            flipImage: true
        };

        parentData.objects[id] = objectData;

        let object = new SimuloObject(this, body, id);
        this.bodies[id] = object;
        return object;
    }
    deleteObjects: (Box2D.b2Body | Box2D.b2Joint | Box2D.b2Fixture)[] = [];
    deletePromises: { resolve: () => void, reject: () => void }[] = [];
    async destroy(object: SimuloObject | SimuloJoint) {
        if (object instanceof SimuloObject) {
            //this.deleteObjects.push(object._body);
            await object.destroy();
        }
        else if (object instanceof SimuloJoint) {
            this.deleteObjects.push(object._joint);
        }
    }
    destroyPhysicsServer() {
        // @ts-ignore
        this.world.SetContactListener(null);
        // @ts-ignore
        this.world.SetContactFilter(null);
        // @ts-ignore
        this.world.SetDestructionListener(null);
        // @ts-ignore
        this.world.SetDebugDraw(null);
        // @ts-ignore
        this.ground = null;
        // @ts-ignore
        this.deleteObjects = null;
        // @ts-ignore
        this.deletePromises = null;
        // @ts-ignore
        this.bodies = null;
        // @ts-ignore
        this.world = null;
    }

    // distancejoints and mousejoints are considered springs.
    addMouseSpring(
        object: SimuloObject, // this is bodyb
        point: [x: number, y: number],
        stiffness: number,
        damping: number,
        maxForce: number,
        width: number,
    ) {
        let mouseJointDef = new box2D.b2MouseJointDef();
        mouseJointDef.set_bodyA(this.ground);
        mouseJointDef.set_bodyB(object._body);
        mouseJointDef.set_target(new box2D.b2Vec2(point[0], point[1]));
        mouseJointDef.set_maxForce(maxForce);
        mouseJointDef.set_stiffness(stiffness);
        mouseJointDef.set_damping(damping);
        let mouseJoint = this.world.CreateJoint(mouseJointDef);
        // add jointdata
        let jointData = mouseJoint.GetUserData() as SimuloJointData;
        jointData.id = this.currentID++;
        jointData.zDepth = this.highestZDepth++;
        jointData.line = {
            color: "#ffffff",
            scale_with_zoom: true
        };
        jointData.width = width;
        jointData.image = null;
        jointData.anchorA = point;
        jointData.anchorB = point;
        jointData.objectA = 0;
        jointData.objectB = object.id;
        let joint = new SimuloMouseSpring(this, mouseJoint);
        return joint;
    }
    particleSystem: Box2D.b2ParticleSystem;

    constructor(theme: SimuloTheme) { // theme is the starting theme for the room to know what to set background to for example and new objects
        const gravity = new box2D.b2Vec2(0, 9.81);
        const world = new box2D.b2World(gravity);

        world.SetContinuousPhysics(true);

        const bd_ground = new box2D.b2BodyDef();
        const ground = world.CreateBody(bd_ground);
        let groundParentData = ground.GetUserData() as SimuloParentData;
        groundParentData.objects = {};
        let groundData: SimuloObjectData = {
            id: 0,
            positionOffset: [0, 0],
            angleOffset: 0,
            name: 'Ground Body',
            sound: null,
            color: 'gray',
            border: null,
            borderWidth: null,
            borderScaleWithZoom: false,
            circleCake: false,
            image: null,
            zDepth: this.highestZDepth++,
            flipImage: true
        };
        groundParentData.id = 1;
        groundParentData.objects[0] = groundData;
        this.currentID = 2; // we hardcode this and the above just to be 10 trillion percent sure that the ground body is always id 0

        this.ground = ground;

        this.world = world;
        this.theme = theme;

        let contactListener = new box2D.JSContactListener();
        contactListener.BeginContact = (contactPtr: number) => {
            let contact = box2D.wrapPointer(contactPtr, box2D.b2Contact);
            // get object mass if non-zero
            let mass1 = contact.GetFixtureA().GetBody().GetMass();
            let mass2 = contact.GetFixtureB().GetBody().GetMass();
            let fixtureAData = contact.GetFixtureA().GetUserData() as SimuloFixtureData;
            let fixtureBData = contact.GetFixtureB().GetUserData() as SimuloFixtureData;
            // get userdata as SimuloObjectData
            let parent1Data = contact.GetFixtureA().GetBody().GetUserData() as SimuloParentData;
            let parent2Data = contact.GetFixtureB().GetBody().GetUserData() as SimuloParentData;
            // get object data from fixture?Data.id
            let data1 = parent1Data.objects[fixtureAData.id];
            let data2 = parent2Data.objects[fixtureBData.id];
            // if static and mass 0, set to 10
            if (
                mass1 == 0 &&
                contact.GetFixtureA().GetBody().GetType() == box2D.b2_staticBody
            ) {
                mass1 = 10;
            }
            if (
                mass2 == 0 &&
                contact.GetFixtureB().GetBody().GetType() == box2D.b2_staticBody
            ) {
                mass2 = 10;
            }
            let sound1 =
                data1.sound || this.defaultImpact;
            let sound2 =
                data2.sound || this.defaultImpact;

            // we want to play a collision noise
            // first, calculate volume based on how hard they hit
            let volume =
                Math.max(
                    contact.GetFixtureA().GetBody().GetLinearVelocity().Length(),
                    contact.GetFixtureB().GetBody().GetLinearVelocity().Length()
                ) / 100;
            this.emit("collision", {
                sound: sound1,
                volume: Math.max(Math.min(Math.abs(volume * mass2), 1), 0),
                pitch: randomRange(0.5, 1.5),
            });
            this.emit("collision", {
                sound: sound2,
                volume: Math.max(Math.min(Math.abs(volume * mass1), 1), 0),
                pitch: randomRange(0.5, 1.5),
            });
        };
        contactListener.EndContact = function (contactPtr: number) {
            let contact = box2D.wrapPointer(contactPtr, box2D.b2Contact);
            // nothing for now, soon it will call JS scripts that listen for collisions
        };
        contactListener.PreSolve = function (contactPtr: number, oldManifoldPtr: number) {
            let contact = box2D.wrapPointer(contactPtr, box2D.b2Contact);
            // nothing for now, soon it will call JS scripts that listen for collisions
        };
        contactListener.PostSolve = function (contactPtr: number, impulsePtr: number) {
            let contact = box2D.wrapPointer(contactPtr, box2D.b2Contact);
            // nothing for now, soon it will call JS scripts that listen for collisions
        };

        world.SetContactListener(contactListener);

        // TODO: make the following floor not be created here, but instead by ServerController
        // huge floor under ground of 500 units high, and 10000 units wide
        const bd_floor = new box2D.b2BodyDef();
        bd_floor.set_type(box2D.b2_staticBody);
        bd_floor.set_position(new box2D.b2Vec2(0, 25030));
        const floor = world.CreateBody(bd_floor);
        const floorShape = new box2D.b2PolygonShape();
        floorShape.SetAsBox(50000, 25000);
        let fixture = floor.CreateFixture(floorShape, 0);
        let fixtureData = fixture.GetUserData() as SimuloFixtureData;
        fixtureData.id = this.currentID++;
        let floorParentData = floor.GetUserData() as SimuloParentData;
        floorParentData.id = this.currentID++;
        floorParentData.objects = {};
        let floorData: SimuloObjectData = {
            id: fixtureData.id,
            positionOffset: [0, 0],
            angleOffset: 0,
            name: 'Floor (Simulo Planet) (not canonically flat)',
            sound: "ground.wav",
            color: theme.ground.color,
            border: theme.ground.border,
            borderWidth: theme.ground.borderWidth,
            borderScaleWithZoom: theme.ground.borderScaleWithZoom,
            circleCake: false,
            image: null,
            zDepth: this.highestZDepth++,
            flipImage: true,
            points: [
                [floorShape.get_m_vertices(0).get_x(), floorShape.get_m_vertices(0).get_y()],
                [floorShape.get_m_vertices(1).get_x(), floorShape.get_m_vertices(1).get_y()],
                [floorShape.get_m_vertices(2).get_x(), floorShape.get_m_vertices(2).get_y()],
                [floorShape.get_m_vertices(3).get_x(), floorShape.get_m_vertices(3).get_y()]
            ]
        };
        floorParentData.objects[floorData.id] = floorData;

        this.addPerson([0, 0]);

        // add water
        const psd = new box2D.b2ParticleSystemDef();
        psd.set_radius(0.1);
        psd.set_dampingStrength(0.2);
        const particleSystem = world.CreateParticleSystem(psd);

        /*
                let box = new box2D.b2PolygonShape();
                let pgd = new box2D.b2ParticleGroupDef();
                box.SetAsBox(1, 0.5);
                pgd.flags = box2D.b2_elasticParticle;
                pgd.groupFlags = box2D.b2_solidParticleGroup;
                pgd.position.Set(1, 4);
                pgd.angle = -0.5;
                pgd.angularVelocity = 2;
                pgd.shape = box;
                pgd.color.Set(0, 0, 255, 255);
                particleSystem.CreateParticleGroup(pgd);
                box2D.destroy(box);
                box2D.destroy(pgd);*/

        this.particleSystem = particleSystem;
    }

    private getParticle = (particleSystem: Box2D.b2ParticleSystem, index: number) => {
        const posBuffer = particleSystem.GetPositionBuffer();
        const pos_p = box2D.getPointer(posBuffer) + index * 8;
        const x = box2D.HEAPF32[pos_p >> 2];
        const y = box2D.HEAPF32[(pos_p + 4) >> 2];
        const color = particleSystem.GetColorBuffer();
        const color_p = box2D.getPointer(color) + index * 4;
        const r = box2D.HEAPU8[color_p];
        const g = box2D.HEAPU8[color_p + 1];
        const b = box2D.HEAPU8[color_p + 2];
        const a = box2D.HEAPU8[color_p + 3];
        const velocityBuffer = particleSystem.GetVelocityBuffer();
        const velocity_p = box2D.getPointer(velocityBuffer) + index * 8;
        const vx = box2D.HEAPF32[velocity_p >> 2];
        const vy = box2D.HEAPF32[(velocity_p + 4) >> 2];
        //console.log(`particle rgba(${r},${g},${b},${a / 255})`);
        return {
            x, y, color: `rgba(${r},${g},${b},${a / 255})`, radius: 0.1, index, colorValues: [r, g, b, a], velocity: { x: vx, y: vy }
        } as SimuloParticle;
    };

    addParticle(particle: SimuloParticle) {
        const particleSystem = this.particleSystem;
        const pd = new box2D.b2ParticleDef();
        pd.set_position(new box2D.b2Vec2(particle.x, particle.y));
        pd.set_color(new box2D.b2ParticleColor(particle.colorValues[0], particle.colorValues[1], particle.colorValues[2], particle.colorValues[3]));
        pd.set_velocity(new box2D.b2Vec2(particle.velocity.x, particle.velocity.y));
        particleSystem.CreateParticle(pd);
    }

    private getAllParticles = (particleSystem: Box2D.b2ParticleSystem) => {
        // we use getParticlePosition

        // first, get count:
        const count = particleSystem.GetParticleCount();
        const particles: SimuloParticle[] = [];
        for (let i = 0; i < count; i++) {
            particles.push(this.getParticle(particleSystem, i));
        }
        return particles;
    }
    deleteAllParticles() {
        const particleSystem = this.particleSystem;
        const count = particleSystem.GetParticleCount();
        for (let i = 0; i < count; i++) {
            particleSystem.DestroyParticle(i);
        }
    }
    deleteParticle(index: number) {
        const particleSystem = this.particleSystem;
        particleSystem.DestroyParticle(index);
    }

    getStuffAtPoint(point: [x: number, y: number]) {
        let pos = new box2D.b2Vec2(point[0], point[1]);
        let selectedObjects: SimuloObject[] = [];
        let selectedJoints: SimuloJoint[] = [];
        let node = this.world.GetBodyList();
        while (box2D.getPointer(node)) {
            let b = node;
            node = node.GetNext();

            let position = b.GetPosition();

            let fl = b.GetFixtureList();
            if (!fl) {
                continue;
            }
            while (box2D.getPointer(fl)) {
                let shape = fl.GetShape();
                let shapeType = shape.GetType();
                if (shapeType == box2D.b2Shape.e_circle) {
                    // test point in fixture (fl.TestPoint)
                    if (fl.TestPoint(pos)) {
                        // make sure the ID is not already in the list
                        let fixtureData = fl.GetUserData() as SimuloFixtureData;
                        let matchingObject = selectedObjects.find((o) => o.id == fixtureData.id);
                        if (!matchingObject) {
                            // we found a body
                            selectedObjects.push(new SimuloObject(this, b, fixtureData.id));
                        }
                        break;
                    }
                } else if (shapeType == box2D.b2Shape.e_polygon) {
                    // test point in fixture (fl.TestPoint)
                    if (fl.TestPoint(pos)) {
                        // make sure the ID is not already in the list
                        let fixtureData = fl.GetUserData() as SimuloFixtureData;
                        let matchingObject = selectedObjects.find((o) => o.id == fixtureData.id);
                        if (!matchingObject) {
                            // we found a body
                            selectedObjects.push(new SimuloObject(this, b, fixtureData.id));
                        }
                        break;
                    }
                }
                fl = fl.GetNext();
            }
            let jl = b.GetJointList();
            while (box2D.getPointer(jl)) {
                // if its distance joint
                let joint = jl.get_joint();
                jl = jl.get_next();
                let jointType = joint.GetType();
                if (jointType == box2D.e_distanceJoint) {
                    // we use calculateDistanceToLine, it automatically gets distance to anywhere on line
                    let d = box2D.castObject(joint, box2D.b2DistanceJoint);
                    let p1 = [d.GetAnchorA().get_x(), d.GetAnchorA().get_y()];
                    let p2 = [d.GetAnchorB().get_x(), d.GetAnchorB().get_y()];
                    let distance = calculateDistanceToLine(p1[0], p1[1], p2[0], p2[1], point[0], point[1]);
                    let width = (d.GetUserData() as SimuloJointData).width;
                    if (distance < (width * 1.1)) {
                        // make sure the ID is not already in the list
                        let jointData = joint.GetUserData() as SimuloJointData;
                        let matchingObject = selectedObjects.find((o) => o.id == jointData.id);
                        if (!matchingObject) {
                            // we found a joint
                            selectedJoints.push(new SimuloJoint(this, joint));
                        }
                        break;
                    }
                }
                // we also support hinge and weld, nothing else in selection
                else if (jointType == box2D.e_revoluteJoint) {
                    // distance to center of it
                    let d = box2D.castObject(joint, box2D.b2RevoluteJoint);
                    let p1 = [d.GetAnchorA().get_x(), d.GetAnchorA().get_y()];
                    // no p2, and no function, just distance to a regular point with Math funcs:
                    let distance = Math.sqrt(Math.pow(p1[0] - point[0], 2) + Math.pow(p1[1] - point[1], 2));
                    if (distance < 0.5) {
                        // make sure the ID is not already in the list
                        let jointData = joint.GetUserData() as SimuloJointData;
                        let matchingObject = selectedObjects.find((o) => o.id == jointData.id);
                        if (!matchingObject) {
                            // we found a joint
                            selectedJoints.push(new SimuloJoint(this, joint));
                        }
                        break;
                    }
                }
                else if (jointType == box2D.e_weldJoint) {
                    // distance to center of it
                    let d = box2D.castObject(joint, box2D.b2WeldJoint);
                    let p1 = [d.GetAnchorA().get_x(), d.GetAnchorA().get_y()];
                    // no p2, and no function, just distance to a regular point with Math funcs:
                    let distance = Math.sqrt(Math.pow(p1[0] - point[0], 2) + Math.pow(p1[1] - point[1], 2));
                    if (distance < 0.5) {
                        // make sure the ID is not already in the list
                        let jointData = joint.GetUserData() as SimuloJointData;
                        let matchingObject = selectedObjects.find((o) => o.id == jointData.id);
                        if (!matchingObject) {
                            // we found a joint
                            selectedJoints.push(new SimuloJoint(this, joint));
                        }
                        break;
                    }
                }
            }



        }
        return {
            objects: selectedObjects.sort((a, b) => { // sort by .zDepth
                return a.zDepth - b.zDepth;
            }),
            joints: selectedJoints.sort((a, b) => { // sort by .zDepth
                return a.zDepth - b.zDepth;
            })
        };
    }
    addParticleBox(x: number, y: number, width: number, height: number) {
        const particleGroupDef = new box2D.b2ParticleGroupDef();
        particleGroupDef.set_color(new box2D.b2ParticleColor(131, 225, 205, 128));
        let boxShape = new box2D.b2PolygonShape();
        boxShape.SetAsBox(width / 2, height / 2, new box2D.b2Vec2(x, y), 0);
        particleGroupDef.set_shape(boxShape);
        this.particleSystem.CreateParticleGroup(particleGroupDef);

        box2D.destroy(boxShape);
        box2D.destroy(particleGroupDef);
    }

    filterDuplicates(objects: SimuloObject[]) {
        // all we check for is unique IDs
        let ids: number[] = [];
        let filtered: SimuloObject[] = [];
        for (let i = 0; i < objects.length; i++) {
            let obj = objects[i];
            if (ids.indexOf(obj.id) == -1) {
                ids.push(obj.id);
                filtered.push(obj);
            }
        }
        return filtered;
    }

    getAllObjects() {
        let objects: SimuloObject[] = [];
        let node = this.world.GetBodyList();
        while (box2D.getPointer(node)) {
            let b = node;
            node = node.GetNext();
            let bData = b.GetUserData() as SimuloParentData;
            for (let key in bData.objects) {
                objects.push(new SimuloObject(this, b, bData.objects[key].id));
            }
        }
        return this.filterDuplicates(objects.sort((a, b) => { // sort by .zDepth
            return a.zDepth - b.zDepth;
        }));
    }

    /** Saves a collection of `SimuloObject`s to a `SimuloSavedObject`s you can restore with `load()` */
    save(stuff: SimuloObject[], groundBodyOffset: { x: number, y: number } = { x: 0, y: 0 }): SimuloSavedObject[] {
        let savedStuff: SimuloSavedObject[] = stuff.map((o) => {
            // get joints of object
            let joints: SimuloSavedJoint[] = [];
            let jointList = o._body.GetJointList();
            while (box2D.getPointer(jointList)) {
                let j = jointList;
                jointList = jointList.next;
                let joint = j.joint;
                let jointData = joint.GetUserData() as SimuloJointData;
                let bodyB = joint.GetBodyB();
                let objectB = new SimuloObject(this, bodyB, jointData.objectB);
                let bodyBID = jointData.objectB;
                let bodyA = joint.GetBodyA();
                let objectA = new SimuloObject(this, bodyA, jointData.objectA);
                let bodyAID = jointData.objectA;
                let jointType = joint.GetType();
                let jointTypeParsed: string;
                let localAnchorA = jointData.anchorA;
                let localAnchorB = jointData.anchorB;
                // if bodyAID is 0, its ground, subtract groundBodyOffset
                if (bodyAID === 0) {
                    localAnchorA = [localAnchorA[0] - groundBodyOffset.x, localAnchorA[1] - groundBodyOffset.y];
                }
                // if bodyBID is 0, its ground, subtract groundBodyOffset
                if (bodyBID === 0) {
                    localAnchorB = [localAnchorB[0] - groundBodyOffset.x, localAnchorB[1] - groundBodyOffset.y];
                }
                let baseObject = {
                    id: jointData.id,
                    bodyA: bodyAID,
                    bodyB: bodyBID,
                    anchorA: localAnchorA,
                    anchorB: localAnchorB,
                    collideConnected: joint.GetCollideConnected(),
                    zDepth: jointData.zDepth,
                    image: jointData.image,
                };
                if (jointType === box2D.e_revoluteJoint) {
                    jointTypeParsed = "axle";
                    let revoluteJoint = box2D.castObject(joint, box2D.b2RevoluteJoint);
                    joints.push({
                        ...baseObject,
                        type: jointTypeParsed,
                        lowerLimit: revoluteJoint.GetLowerLimit(),
                        upperLimit: revoluteJoint.GetUpperLimit(),
                        enableLimit: revoluteJoint.IsLimitEnabled(),
                        motorSpeed: revoluteJoint.GetMotorSpeed(),
                        maxMotorTorque: revoluteJoint.GetMaxMotorTorque(),
                        enableMotor: revoluteJoint.IsMotorEnabled(),
                    });
                } else if (jointType === box2D.e_prismaticJoint) {
                    jointTypeParsed = "slider";
                    let prismaticJoint = box2D.castObject(joint, box2D.b2PrismaticJoint);
                    joints.push({
                        ...baseObject,
                        type: jointTypeParsed,
                        lowerTranslation: prismaticJoint.GetLowerLimit(),
                        upperTranslation: prismaticJoint.GetUpperLimit(),
                        enableLimit: prismaticJoint.IsLimitEnabled(),
                        motorSpeed: prismaticJoint.GetMotorSpeed(),
                        maxMotorForce: prismaticJoint.GetMaxMotorForce(),
                        enableMotor: prismaticJoint.IsMotorEnabled(),
                    });
                } else if (jointType === box2D.e_distanceJoint) {
                    jointTypeParsed = "spring";
                    let distanceJoint = box2D.castObject(joint, box2D.b2DistanceJoint);
                    joints.push({
                        ...baseObject,
                        type: jointTypeParsed,
                        dampingRatio: distanceJoint.GetDamping(),
                        frequencyHz: distanceJoint.GetStiffness(),
                        length: distanceJoint.GetLength(),
                        image: jointData.image,
                        width: jointData.width,
                        line: jointData.line,
                    });
                } else if (jointType === box2D.e_pulleyJoint) {
                    jointTypeParsed = "pulley";
                    let pulleyJoint = box2D.castObject(joint, box2D.b2PulleyJoint);
                    joints.push({
                        ...baseObject,
                        type: jointTypeParsed,
                        groundAnchorA: [pulleyJoint.GetGroundAnchorA().get_x(), pulleyJoint.GetGroundAnchorA().get_y()],
                        groundAnchorB: [pulleyJoint.GetGroundAnchorB().get_x(), pulleyJoint.GetGroundAnchorB().get_y()],
                        lengthA: pulleyJoint.GetLengthA(),
                        lengthB: pulleyJoint.GetLengthB(),
                        ratio: pulleyJoint.GetRatio(),
                    });
                } else if (jointType === box2D.e_mouseJoint) {
                    /*jointTypeParsed = "mouseSpring";
                    let mouseJoint = box2D.castObject(joint, box2D.b2MouseJoint);
                    joints.push({
                        ...baseObject,
                        type: jointTypeParsed,
                        dampingRatio: mouseJoint.GetDamping(),
                        frequencyHz: mouseJoint.GetStiffness(),
                        maxForce: mouseJoint.GetMaxForce(),
                    });*/
                    // skip this, we dont yet save mouse joints
                } else if (jointType === box2D.e_gearJoint) {
                    jointTypeParsed = "gear";
                    let gearJoint = box2D.castObject(joint, box2D.b2GearJoint);
                    joints.push({
                        ...baseObject,
                        type: jointTypeParsed,
                        ratio: gearJoint.GetRatio(),
                    });
                } else if (jointType === box2D.e_wheelJoint) {
                    jointTypeParsed = "wheel";
                    let wheelJoint = box2D.castObject(joint, box2D.b2WheelJoint);
                    joints.push({
                        ...baseObject,
                        type: jointTypeParsed,
                        dampingRatio: wheelJoint.GetDamping(),
                        frequencyHz: wheelJoint.GetStiffness(),
                        motorSpeed: wheelJoint.GetMotorSpeed(),
                        maxMotorTorque: wheelJoint.GetMaxMotorTorque(),
                        enableMotor: wheelJoint.IsMotorEnabled(),
                    });
                } else if (jointType === box2D.e_weldJoint) {
                    jointTypeParsed = "bolt";
                    let weldJoint = box2D.castObject(joint, box2D.b2WeldJoint);
                    joints.push({
                        ...baseObject,
                        type: jointTypeParsed,
                        dampingRatio: weldJoint.GetDamping(),
                        frequencyHz: weldJoint.GetStiffness(),
                    });
                } else if (jointType === box2D.e_frictionJoint) {
                    jointTypeParsed = "friction";
                    let frictionJoint = box2D.castObject(joint, box2D.b2FrictionJoint);
                    joints.push({
                        ...baseObject,
                        type: jointTypeParsed,
                        maxForce: frictionJoint.GetMaxForce(),
                        maxTorque: frictionJoint.GetMaxTorque(),
                    });
                } else if (jointType === box2D.e_ropeJoint) {
                    // skip for now
                } else if (jointType === box2D.e_motorJoint) {
                    // skip for now
                } else {
                    jointTypeParsed = "unknown";
                }
            }

            return {
                id: o.id,
                type: o.type,
                position: o.position,
                rotation: o.rotation,
                velocity: o.velocity,
                angularVelocity: o.angularVelocity,
                density: o.density,
                friction: o.friction,
                restitution: o.restitution,
                border: o.border,
                borderWidth: o.borderWidth,
                borderScaleWithZoom: o.borderScaleWithZoom,
                circleCake: o.circleCake,
                image: o.image,
                sound: o.collisionSound,
                color: o.color,
                isStatic: o.isStatic,
                mass: o.mass,
                joints: joints,
                points: o.points,
                radius: o.radius,
                name: o.name ? o.name : null,
                parentID: o.parentID,
                flipImage: o.flipImage,
            };
        });
        return savedStuff;
    }

    saveWorld(): { objects: SimuloSavedObject[]; particles: SimuloParticle[], theme: SimuloTheme } {
        // get all objects
        let objects: SimuloObject[] = this.getAllObjects();
        // filter out object 0, which is the ground body
        objects = objects.filter((o) => o.id !== 0);
        let particles = this.getAllParticles(this.particleSystem);
        // save them with save()
        return {
            objects: this.save(objects),
            particles,
            theme: this.theme,
        };
    }
    async loadWorld(stuff: { objects: SimuloSavedObject[]; particles: SimuloParticle[], theme: SimuloTheme }) {
        // get all objects
        let objects: SimuloObject[] = this.getAllObjects();
        // filter out object 0, which is the ground body
        objects = objects.filter((o) => o.id !== 0);
        // delete them
        for (let i = 0; i < objects.length; i++) {
            await objects[i].destroy();
        }
        this.theme = stuff.theme;
        this.emit("themeChange", this.theme);
        // delete all particles
        this.deleteAllParticles();
        this.currentID = 1;
        // load them with load()
        this.load(stuff.objects);
        this.loadParticles(stuff.particles);
    }

    loadParticles(particles: SimuloParticle[]) {
        particles.forEach((p) => {
            this.addParticle(p);
        });
    }

    /** Spawns in some `SimuloObject`s from a `SimuloSavedObject[]` you saved with `save()`, doesn't replace anything, just adds to the world */
    load(stuff: SimuloSavedObject[], groundBodyOffset: { x: number, y: number } = { x: 0, y: 0 }) {
        let jointsToAdd: any[] = [];
        let realIDs: { [key: number]: number } = {};

        stuff.forEach((o) => {
            let obj: SimuloObject | null = null;
            // if its a polygon, use addPolygon
            if (o.type === SimuloObjectType.POLYGON) {
                if (o.points) {
                    obj = this.addPolygon(o.points as [x: number, y: number][], [o.position.x, o.position.y], o.rotation, o.density, o.friction, o.restitution, {
                        border: o.border,
                        borderWidth: o.borderWidth,
                        borderScaleWithZoom: o.borderScaleWithZoom,
                        circleCake: o.circleCake,
                        image: o.image,
                        sound: o.sound,
                        color: o.color,
                        name: (o.name === null ? undefined : o.name),
                        flipImage: o.flipImage
                    }, o.isStatic);
                }
            }
            // if its a circle, use addCircle
            else if (o.type === SimuloObjectType.CIRCLE) {
                obj = this.addCircle(o.radius as number, [o.position.x, o.position.y], o.rotation, o.density, o.friction, o.restitution, {
                    border: o.border,
                    borderWidth: o.borderWidth,
                    borderScaleWithZoom: o.borderScaleWithZoom,
                    circleCake: o.circleCake,
                    image: o.image,
                    sound: o.sound,
                    color: o.color,
                    name: (o.name === null ? undefined : o.name),
                    flipImage: o.flipImage
                }, o.isStatic);
            }
            if (obj) {
                let object = obj as SimuloObject; // im sick and tired of TS saying "oh but obj could be null!!" after i checked already
                object.velocity = o.velocity;
                object.angularVelocity = o.angularVelocity;
                jointsToAdd = jointsToAdd.concat(o.joints);

                realIDs[o.id] = object.id;
            }
        });

        // filter jointsToAdd to remove duplicate .id
        jointsToAdd = jointsToAdd.filter((j, i, a) => {
            return a.findIndex((j2) => j2.id === j.id) === i;
        });

        jointsToAdd.forEach((j) => {
            let objectAID = realIDs[j.bodyA];
            let objectBID = realIDs[j.bodyB];

            // ground body support
            if (j.bodyA === 0) objectAID = 0;
            if (j.bodyB === 0) objectBID = 0;

            let objectA = this.getObjectByID(objectAID) as SimuloObject;
            let objectB = this.getObjectByID(objectBID) as SimuloObject;

            let anchorA = j.anchorA;
            let anchorB = j.anchorB;

            if (j.bodyA === 0) {
                anchorA[0] += groundBodyOffset.x;
                anchorA[1] += groundBodyOffset.y;
            }
            if (j.bodyB === 0) {
                anchorB[0] += groundBodyOffset.x;
                anchorB[1] += groundBodyOffset.y;
            }

            // for now, lets only re-add axle (revolute) and spring (distance) joints since we dont use others
            if (j.type === "axle") {
                this.addAxle(anchorA, anchorB, objectA, objectB, j.image);
            }
            else if (j.type === "spring") {
                this.addSpring(anchorA, anchorB, objectA, objectB, j.frequencyHz, j.length, j.dampingRatio, j.width, j.image, j.line);
            }
            else if (j.type === "bolt") {
                this.addBolt(anchorA, anchorB, objectA, objectB, j.image);
            }
        });
    }

    getObjectByID(id: number) {
        let node = this.world.GetBodyList();
        while (box2D.getPointer(node)) {
            let b = node;
            node = node.GetNext();

            let parentData = b.GetUserData() as SimuloParentData;
            if (parentData.objects[id]) {
                return new SimuloObject(this, b, id);
            }
        }
        return null;
    }
    getTouchingObjects(object: SimuloObject) {
        let selectedObjects: SimuloObject[] = [];
        let node = this.world.GetBodyList();
        while (box2D.getPointer(node)) {
            let b = node;
            node = node.GetNext();

            let parentData = b.GetUserData() as SimuloParentData;
            if (parentData.objects[object.id]) {
                continue;
            }

            let contactList = b.GetContactList();
            while (box2D.getPointer(contactList)) {
                let contact = contactList;
                contactList = contactList.get_next();

                let contactData = contact.get_contact();
                let fixtureA = contactData.GetFixtureA();
                let fixtureB = contactData.GetFixtureB();
                if (fixtureA.GetBody() === object._body) {
                    selectedObjects.push(new SimuloObject(this, b, (fixtureA.GetUserData() as SimuloFixtureData).id));
                    break;
                }
                if (fixtureB.GetBody() === object._body) {
                    selectedObjects.push(new SimuloObject(this, b, (fixtureB.GetUserData() as SimuloFixtureData).id));
                    break;
                }
            }
        }

        selectedObjects = selectedObjects.filter((obj, index, self) =>
            index === self.findIndex((t) => (
                t.id === obj.id
            ))
        );
        return selectedObjects.sort((a, b) => { // sort by .zDepth
            return a.zDepth - b.zDepth;
        });
    }

    getStuffInRect(pointA: [x: number, y: number], pointB: [x: number, y: number]) {
        let posA = new box2D.b2Vec2(pointA[0], pointA[1]);
        let posB = new box2D.b2Vec2(pointB[0], pointB[1]);

        // reverse the points if they are backwards (posA needs to be top left, posB needs to be bottom right)
        if (posA.get_x() > posB.get_x()) {
            let temp = posA.get_x();
            posA.set_x(posB.get_x());
            posB.set_x(temp);
        }
        if (posA.get_y() > posB.get_y()) {
            let temp = posA.get_y();
            posA.set_y(posB.get_y());
            posB.set_y(temp);
        }

        // we queryaabb
        let selectedObjects: SimuloObject[] = [];
        let aabb = new box2D.b2AABB();
        aabb.set_lowerBound(posA);
        aabb.set_upperBound(posB);
        /*this.world.QueryAABB((fixturePtr: number) => {
            let fixture = box2D.wrapPointer(fixturePtr, box2D.b2Fixture);
            let body = fixture.GetBody();
            selectedBodies.push(body);
            return true;
        }, aabb);*/
        let callback = new box2D.JSQueryCallback();
        callback.ReportFixture = (fixturePtr: number) => {
            let fixture = box2D.wrapPointer(fixturePtr, box2D.b2Fixture);
            /*let body = fixture.GetBody();
            selectedBodies.push(body);*/
            let fixtureData = fixture.GetUserData() as SimuloFixtureData;
            selectedObjects.push(new SimuloObject(this, fixture.GetBody(), fixtureData.id));
            return true;
        };

        // we dont want to query the particle system, because we can easily do that manually with more control over logic
        callback.ShouldQueryParticleSystem = function (system: Box2D.b2ParticleSystem) {
            return false;
        };
        this.world.QueryAABB(callback, aabb);
        /*return selectedBodies.map((b) => {
            return new SimuloObject(this, b);
        });*/

        // now we have a rough selection. however, on rotated boxes and on polygons, the selection is not perfect. lets testpoint on the fixtures
        /*// lets use intersect function. it takes {x: number, y:number}[]s
        let rect = [
            { x: posA.get_x(), y: posA.get_y() },
            { x: posB.get_x(), y: posA.get_y() },
            { x: posB.get_x(), y: posB.get_y() },
            { x: posA.get_x(), y: posB.get_y() },
        ];*/ // the extra filter didnt work yet, the AABB is sufficient for alpha

        // remove duplicate .id
        selectedObjects = selectedObjects.filter((obj, index, self) =>
            index === self.findIndex((t) => (
                t.id === obj.id
            ))
        );

        let selectedJoints: SimuloJoint[] = [];

        let jl = this.world.GetJointList();
        while (box2D.getPointer(jl)) {
            let joint = jl;
            jl = jl.GetNext();
            let jointType = joint.GetType();
            if (jointType == box2D.e_distanceJoint) {
                // nothing for now
            }
            // revolute and weld too
            else if (jointType == box2D.e_revoluteJoint) {
                // distance to center of it
                let d = box2D.castObject(joint, box2D.b2RevoluteJoint);
                let p1 = [d.GetAnchorA().get_x(), d.GetAnchorA().get_y()];
                // no p2, and no function, just distance to a regular point with Math funcs:
                let p1InRect = p1[0] > posA.get_x() && p1[0] < posB.get_x() && p1[1] > posA.get_y() && p1[1] < posB.get_y();
                if (p1InRect) {
                    // make sure the ID is not already in the list
                    let jointData = joint.GetUserData() as SimuloJointData;
                    let matchingObject = selectedObjects.find((o) => o.id == jointData.id);
                    if (!matchingObject) {
                        // we found a joint
                        selectedJoints.push(new SimuloJoint(this, joint));
                    }
                    break;
                }
            }
            else if (jointType == box2D.e_weldJoint) {
                // distance to center of it
                let d = box2D.castObject(joint, box2D.b2WeldJoint);
                let p1 = [d.GetAnchorA().get_x(), d.GetAnchorA().get_y()];
                // no p2, and no function, just distance to a regular point with Math funcs:
                let p1InRect = p1[0] > posA.get_x() && p1[0] < posB.get_x() && p1[1] > posA.get_y() && p1[1] < posB.get_y();
                if (p1InRect) {
                    // make sure the ID is not already in the list
                    let jointData = joint.GetUserData() as SimuloJointData;
                    let matchingObject = selectedObjects.find((o) => o.id == jointData.id);
                    if (!matchingObject) {
                        // we found a joint
                        selectedJoints.push(new SimuloJoint(this, joint));
                    }
                    break;
                }
            }
        }

        return {
            objects: selectedObjects.sort((a, b) => { // sort by .zDepth
                return a.zDepth - b.zDepth;
            }),
            joints: selectedJoints.sort((a, b) => { // sort by .zDepth
                return a.zDepth - b.zDepth;
            }),
        };
    }

    render() {
        let particles = this.getAllParticles(this.particleSystem);


        // get body
        let node: Box2D.b2Body = this.world.GetBodyList();

        let shapes: SimuloShape[] = [];
        let renderedObjects: number[] = [];

        while (box2D.getPointer(node)) {
            let b = node;
            node = node.GetNext();
            let parentData = b.GetUserData() as SimuloParentData;
            if (!parentData.id) {
                console.log("UH OH! LOOKS LIKE SOMEBODY DOESNT HAVE AN IDENTIFIER! THATS ILLEGAL!")
                continue;
            }
            let position = b.GetPosition();
            //console.log("position: " + position.x + ", " + position.y);
            b.GetType();

            // or was it just an illusion?
            // was it ever even real?
            // was it all just a dream?
            // or was our life not reality?
            // or was it all just a dream?
            // or was our life not achieved?
            // or was our mind just a construct beyond the world above?

            let fl = b.GetFixtureList();
            while (box2D.getPointer(fl)) {
                let shape = fl.GetShape();
                let shapeType: number;
                try {
                    shapeType = shape.GetType();
                } catch (e) {
                    fl = fl.GetNext();
                    continue;
                }

                // skip if already rendered
                let fixtureData = fl.GetUserData() as SimuloFixtureData;
                if (renderedObjects.includes(fixtureData.id)) {
                    fl = fl.GetNext();
                    continue;
                }

                let objectData = parentData.objects[fixtureData.id];

                // SUPERTODO offset position and angle

                if (shapeType == box2D.b2Shape.e_circle) {
                    const circleShape = box2D.castObject(shape, box2D.b2CircleShape);
                    //console.log("circle of radius " + circleShape.get_m_radius() + " at " + position.x + ", " + position.y);
                    shapes.push({
                        x: position.x,
                        y: position.y,
                        type: "circle",
                        radius: circleShape.get_m_radius(),
                        angle: b.GetAngle(),
                        color: objectData.color,
                        border: objectData.border,
                        borderWidth: objectData.borderWidth,
                        borderScaleWithZoom: objectData.borderScaleWithZoom,
                        circleCake: objectData.circleCake,
                        image: objectData.image,
                        id: objectData.id,
                        zDepth: objectData.zDepth,
                        imageTransformations: {
                            scale: 1,
                            rotate: objectData.flipImage ? Math.PI : 0,
                            translate: [0, 0],
                        }
                    } as SimuloCircle);
                } else if (shapeType == box2D.b2Shape.e_polygon) {
                    const polygonShape = box2D.castObject(shape, box2D.b2PolygonShape);
                    let vertexCount = polygonShape.get_m_count();
                    let verts: { x: number, y: number }[] = [];
                    // iterate over vertices
                    for (let i = 0; i < vertexCount; i++) {
                        const vertex = polygonShape.get_m_vertices(i);
                        //console.log("vertex " + i + " at " + vertex.x + ", " + vertex.y);
                        verts.push({
                            x: vertex.x,
                            y: vertex.y,
                        });
                    }
                    if (!objectData) {
                        console.log('no object data for fixture ' + fixtureData.id + ' of body ' + parentData.id + ' (polygon)');
                    }
                    if (objectData.points != null) {
                        shapes.push({
                            x: position.x,
                            y: position.y,
                            type: "polygon",
                            vertices: verts,
                            angle: b.GetAngle(),
                            color: objectData.color,
                            border: objectData.border,
                            borderWidth: objectData.borderWidth,
                            borderScaleWithZoom: objectData.borderScaleWithZoom,
                            points: objectData.points.map((p) => {
                                return { x: p[0], y: p[1] };
                            }),
                            image: objectData.image,
                            id: objectData.id,
                            zDepth: objectData.zDepth,
                            decomposedParts: objectData.decomposedParts,
                            imageTransformations: {
                                scale: 1,
                                rotate: objectData.flipImage ? Math.PI : 0,
                                translate: [0, 0],
                            }
                        } as SimuloPolygon);
                    }
                    else {
                        shapes.push({
                            x: position.x,
                            y: position.y,
                            type: "polygon",
                            vertices: verts,
                            angle: b.GetAngle(),
                            color: objectData.color,
                            border: objectData.border,
                            borderWidth: objectData.borderWidth,
                            borderScaleWithZoom: objectData.borderScaleWithZoom,
                            image: objectData.image,
                            id: objectData.id,
                            zDepth: objectData.zDepth,
                            decomposedParts: objectData.decomposedParts,
                            imageTransformations: {
                                scale: 1,
                                rotate: objectData.flipImage ? Math.PI : 0,
                                translate: [0, 0],
                            }
                        } as SimuloPolygon);
                    }
                } else if (shapeType == box2D.b2Shape.e_edge) {
                    const edgeShape = box2D.castObject(shape, box2D.b2EdgeShape);
                    let vertices = [
                        {
                            x: edgeShape.get_m_vertex1().get_x(),
                            y: edgeShape.get_m_vertex1().get_y(),
                        },
                        {
                            x: edgeShape.get_m_vertex2().get_x(),
                            y: edgeShape.get_m_vertex2().get_y(),
                        },
                    ];
                    //console.log("edge: ");
                    //console.log(vertices);
                    shapes.push({
                        x: position.x,
                        y: position.y,
                        type: "edge",
                        vertices: vertices,
                        angle: b.GetAngle(),
                        color: objectData.color,
                        border: objectData.border,
                        borderWidth: objectData.borderWidth,
                        borderScaleWithZoom: objectData.borderScaleWithZoom,
                        image: objectData.image,
                        id: objectData.id,
                        zDepth: objectData.zDepth,
                        imageTransformations: {
                            scale: 1,
                            rotate: objectData.flipImage ? Math.PI : 0,
                            translate: [0, 0],
                        }
                    } as SimuloEdge);
                } else {
                    //console.log("unknown shape type");
                }
                fl = fl.GetNext();
                renderedObjects.push(fixtureData.id);
            }
        }

        /*let springsFormatted: { p1: number[], p2: number[] }[] = [];
        springs.forEach((spring) => {
            springsFormatted.push({
                p1: [spring.GetTarget().get_x(), spring.GetTarget().get_y()],
                p2: [spring.GetAnchorB().get_x(), spring.GetAnchorB().get_y()],
            });
        });*/

        let joint = this.world.GetJointList();
        let springs: { p1: number[], p2: number[], image: string | null, line: { color: string, scale_with_zoom: boolean } | null, width: number, zDepth: number, targetLength: number }[] = []; // distance joints are considered springs
        let mouseSprings: { p1: number[], p2: number[], image: string | null, line: { color: string, scale_with_zoom: boolean } | null, width: number, zDepth: number }[] = [];
        while (box2D.getPointer(joint)) {
            let j = joint;
            joint = joint.GetNext();
            if (j.GetType() == box2D.e_distanceJoint) {
                let d = box2D.castObject(j, box2D.b2DistanceJoint);
                let dData = d.GetUserData() as SimuloJointData;
                let image: string | null;
                if (dData.image != null) {
                    image = dData.image;
                }
                else {
                    image = null;
                }
                let line: { color: string, scale_with_zoom: boolean } | null;
                if (dData.line != null) {
                    line = dData.line;
                }
                else {
                    line = null;
                }
                springs.push({
                    p1: [d.GetAnchorA().get_x(), d.GetAnchorA().get_y()],
                    p2: [d.GetAnchorB().get_x(), d.GetAnchorB().get_y()],
                    image: image,
                    line: line,
                    width: dData.width,
                    zDepth: dData.zDepth,
                    targetLength: d.GetLength()
                });
            }
            else if (j.GetType() == box2D.e_mouseJoint) {
                let m = box2D.castObject(j, box2D.b2MouseJoint);
                let mData = m.GetUserData() as SimuloJointData;
                let image: string | null;
                if (mData.image != null) {
                    image = mData.image;
                }
                else {
                    image = null;
                }
                let line: { color: string, scale_with_zoom: boolean } | null;
                if (mData.line != null) {
                    line = mData.line;
                }
                else {
                    line = null;
                }
                mouseSprings.push({
                    p1: [m.GetAnchorA().get_x(), m.GetAnchorA().get_y()],
                    p2: [m.GetAnchorB().get_x(), m.GetAnchorB().get_y()],
                    image: image,
                    line: line,
                    width: mData.width,
                    zDepth: mData.zDepth,
                });
            }
            else if (j.GetType() == box2D.e_revoluteJoint) {
                try {
                    let r = box2D.castObject(j, box2D.b2RevoluteJoint);
                    let rData = r.GetUserData() as SimuloJointData;
                    let anchorRaw = rData.anchorA;
                    if (anchorRaw == null || anchorRaw == undefined) {
                        anchorRaw = rData.anchorB;
                    }
                    if (anchorRaw == null || anchorRaw == undefined) {
                        anchorRaw = [0, 0];
                    }
                    let bodyARot = r.GetBodyA().GetAngle();
                    let bodyBRot = r.GetBodyB().GetAngle();
                    let objectAID = rData.objectA;
                    let objectBID = rData.objectB;
                    // figure out which body is on top (higher zDepth)
                    let bodyRot: number;
                    if (new SimuloObject(this, r.GetBodyA(), objectAID).zDepth > new SimuloObject(this, r.GetBodyB(), objectBID).zDepth) {
                        bodyRot = bodyARot;
                    }
                    else {
                        bodyRot = bodyBRot;
                    }
                    let anchor = this.getWorldPoint(new SimuloObject(this, r.GetBodyA(), objectAID), anchorRaw);
                    let image: string | null;
                    if (rData.image != null) {
                        image = rData.image;
                    }
                    else {
                        image = null;
                    }
                    shapes.push({
                        x: anchor[0],
                        y: anchor[1],
                        type: "circle",
                        vertices: [],
                        angle: bodyRot,
                        color: "#00000000",
                        border: null,
                        borderWidth: null,
                        borderScaleWithZoom: false,
                        image: image,
                        id: rData.id,
                        zDepth: rData.zDepth,
                        circleCake: false,
                        radius: 0.1,
                    } as SimuloCircle);
                }
                catch (e) {
                    console.error('Error in axle joint rendering:', e);
                }
            }
            else if (j.GetType() == box2D.e_weldJoint) {
                try {
                    let w = box2D.castObject(j, box2D.b2WeldJoint);
                    let wData = w.GetUserData() as SimuloJointData;
                    let anchorRaw = wData.anchorA;
                    if (anchorRaw == null || anchorRaw == undefined) {
                        anchorRaw = wData.anchorB;
                    }
                    if (anchorRaw == null || anchorRaw == undefined) {
                        anchorRaw = [0, 0];
                    }
                    let bodyARot = w.GetBodyA().GetAngle();
                    let bodyBRot = w.GetBodyB().GetAngle();
                    let objectAID = wData.objectA;
                    let objectBID = wData.objectB;
                    // figure out which body is on top (higher zDepth)
                    let bodyRot: number;
                    if (new SimuloObject(this, w.GetBodyA(), objectAID).zDepth > new SimuloObject(this, w.GetBodyB(), objectBID).zDepth) {
                        bodyRot = bodyARot;
                    }
                    else {
                        bodyRot = bodyBRot;
                    }
                    let anchor = this.getWorldPoint(new SimuloObject(this, w.GetBodyA(), objectAID), anchorRaw);
                    let image: string | null;
                    if (wData.image != null) {
                        image = wData.image;
                    }
                    else {
                        image = null;
                    }
                    shapes.push({
                        x: anchor[0],
                        y: anchor[1],
                        type: "circle",
                        vertices: [],
                        angle: bodyRot,
                        color: "#00000000",
                        border: null,
                        borderWidth: null,
                        borderScaleWithZoom: false,
                        image: image,
                        id: wData.id,
                        zDepth: wData.zDepth,
                        circleCake: false,
                        radius: 0.1,
                    } as SimuloCircle);
                }
                catch (e) {
                    console.error('Error in weld joint rendering:', e);
                }
            }
        }

        let thisStep: SimuloStep = {
            shapes: shapes.sort((a, b) => {
                return a.zDepth - b.zDepth;
            }),
            background: this.theme.background,
            springs: springs.sort((a, b) => {
                return a.zDepth - b.zDepth;
            }),
            mouseSprings: mouseSprings.sort((a, b) => {
                return a.zDepth - b.zDepth;
            }),
            particles
        };

        return thisStep;
    }

    step(delta: number, velocityIterations: number, positionIterations: number) {
        try {
            this.world.Step(delta, velocityIterations, positionIterations);
        } catch (e) {
            console.error('Error in world.Step', e);
            return false;
        }

        this.deleteObjects.forEach((obj) => {
            if (obj instanceof box2D.b2Body) {
                this.world.DestroyBody(obj);
            }
            if (obj instanceof box2D.b2Joint) {
                this.world.DestroyJoint(obj);
            }
            if (obj instanceof box2D.b2Fixture) {
                obj.GetBody().DestroyFixture(obj);
            }
        });
        this.deleteObjects = [];
        this.deletePromises.forEach((promise) => {
            promise.resolve();
        });
        this.deletePromises = [];

        return true;
    }
    getAllSprings() {
        let joint: Box2D.b2Joint = this.world.GetJointList();
        let springs: { p1: number[], p2: number[], image: string | null, line: { color: string, scale_with_zoom: boolean } | null, width: number }[] = []; // distance joints are considered springs
        let mouseSprings: { p1: number[], p2: number[], image: string | null, line: { color: string, scale_with_zoom: boolean } | null, width: number }[] = [];
        while (box2D.getPointer(joint)) {
            let j = joint;
            joint = joint.GetNext();
            if (j.GetType() == box2D.e_distanceJoint) {
                let d = box2D.castObject(j, box2D.b2DistanceJoint);
                let dData = d.GetUserData() as SimuloJointData;
                let image: string | null;
                if (dData.image != null) {
                    image = dData.image;
                }
                else {
                    image = null;
                }
                let line: { color: string, scale_with_zoom: boolean } | null;
                if (dData.line != null) {
                    line = dData.line;
                }
                else {
                    line = null;
                }
                springs.push({
                    p1: [d.GetAnchorA().get_x(), d.GetAnchorA().get_y()],
                    p2: [d.GetAnchorB().get_x(), d.GetAnchorB().get_y()],
                    image: image,
                    line: line,
                    width: dData.width,
                });
            }
            else if (j.GetType() == box2D.e_mouseJoint) {
                let m = box2D.castObject(j, box2D.b2MouseJoint);
                let mData = m.GetUserData() as SimuloJointData;
                let image: string | null;
                if (mData.image != null) {
                    image = mData.image;
                }
                else {
                    image = null;
                }
                let line: { color: string, scale_with_zoom: boolean } | null;
                if (mData.line != null) {
                    line = mData.line;
                }
                else {
                    line = null;
                }
                mouseSprings.push({
                    p1: [m.GetAnchorA().get_x(), m.GetAnchorA().get_y()],
                    p2: [m.GetAnchorB().get_x(), m.GetAnchorB().get_y()],
                    image: image,
                    line: line,
                    width: mData.width,
                });
            }
        }
        return { springs: springs, mouseSprings: mouseSprings };
    }
}

export default SimuloPhysicsServer;
export { SimuloPhysicsServer, SimuloObject, SimuloJoint, SimuloMouseSpring, SimuloSavedObject };