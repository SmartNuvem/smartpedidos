declare module "@napi-rs/canvas" {
  export type SKRSContext2D = {
    font: string;
    fillStyle: string;
    textBaseline: "top" | "alphabetic" | "middle" | "bottom" | "hanging" | "ideographic";
    measureText: (text: string) => { width: number };
    fillRect: (x: number, y: number, width: number, height: number) => void;
    fillText: (text: string, x: number, y: number, maxWidth?: number) => void;
  };

  export type SKRSCanvas = {
    width: number;
    height: number;
    getContext: (contextId: "2d") => SKRSContext2D;
    encode: (format: "png") => Promise<Buffer>;
  };

  export function createCanvas(width: number, height: number): SKRSCanvas;
}
