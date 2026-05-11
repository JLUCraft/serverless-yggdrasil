import { toBinary, fromBinary } from "@bufbuild/protobuf";
import { create } from "@bufbuild/protobuf";
import { StationRequestSchema } from "./proto/skin_station_pb.ts";

export function encodeStationRequest(requestId: string): Uint8Array {
  const request = create(StationRequestSchema, {
    requestId,
    body: {
      case: "currentUser",
      value: {},
    },
  });

  return toBinary(StationRequestSchema, request);
}

export function decodeStationRequest(bytes: Uint8Array): string {
  return fromBinary(StationRequestSchema, bytes).requestId;
}
