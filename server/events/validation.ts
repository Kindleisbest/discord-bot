import { z } from 'zod';
import { EventError, type EventDraft } from '../../shared/events.js';

const id = z.string().regex(/^\d{17,20}$/);
export const MAX_GRAPHIC_BYTES = 1_048_576;
const eventBaseSchema = z.object({
  name: z.string().trim().min(1).max(100), description: z.string().trim().max(1000),
  startTime: z.iso.datetime(), endTime: z.iso.datetime(),
  entityType: z.enum(['external', 'voice', 'stage']), channelId: id.nullable(),
  location: z.string().trim().min(1).max(100).nullable(),
  announcementChannelId: id, announcementText: z.string().trim().max(2000),
  graphic: z.object({data:z.string().max(1_398_150),alt:z.string().trim().min(1).max(500)}).strict().nullable(),
}).strict();
export const eventDraftSchema = eventBaseSchema.refine(d => Date.parse(d.endTime) > Date.parse(d.startTime), 'The end must be after the start.')
  .refine(d => d.entityType === 'external' ? d.channelId === null && d.location !== null : d.channelId !== null && d.location === null, 'Choose the location for this event type.');
export const savedDraftSchema = eventBaseSchema.omit({graphic:true}).extend({graphicAlt:z.string().min(1).max(500).nullable()});

/** Bound uploaded bytes and dimensions without decoding an image on the Pi. Discord validates image encoding. */
export function validateGraphic(data:string):void {
  const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(data);
  if(!match)throw new EventError(400,'Choose a PNG or JPEG image file.');
  const bytes=Buffer.from(match[2],'base64');
  if(bytes.length>MAX_GRAPHIC_BYTES || bytes.toString('base64')!==match[2])throw new EventError(400,'The graphic must be a valid image upload no larger than 1 MiB.');
  let width=0,height=0;
  if(match[1]==='png') {
    if(bytes.length>=45 && bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      && bytes.readUInt32BE(8)===13 && bytes.toString('ascii',12,16)==='IHDR'
      && bytes.toString('ascii',bytes.length-8,bytes.length-4)==='IEND') {
      width=bytes.readUInt32BE(16);height=bytes.readUInt32BE(20);
    }
  } else if(bytes.length>=4 && bytes.readUInt16BE(0)===0xffd8 && bytes.readUInt16BE(bytes.length-2)===0xffd9) {
    let offset=2;
    while(offset+4<=bytes.length) {
      if(bytes[offset++]!==0xff)break;
      while(bytes[offset]===0xff)offset++;
      const marker=bytes[offset++];
      if(marker===0xda || marker===0xd9)break;
      if(marker===0x01 || (marker>=0xd0 && marker<=0xd7))continue;
      if(offset+2>bytes.length)break;
      const size=bytes.readUInt16BE(offset);
      if(size<2 || offset+size>bytes.length)break;
      if([0xc0,0xc1,0xc2,0xc3,0xc5,0xc6,0xc7,0xc9,0xca,0xcb,0xcd,0xce,0xcf].includes(marker) && size>=8) {
        height=bytes.readUInt16BE(offset+3);width=bytes.readUInt16BE(offset+5);break;
      }
      offset+=size;
    }
  }
  if(!width || !height || width>8192 || height>8192 || width*height>16_000_000) {
    throw new EventError(400,'Use a PNG or JPEG graphic with valid dimensions, at most 8,192 pixels per side and 16 million pixels total.');
  }
}
export function validateEventDraft(input:unknown):EventDraft {
  const draft=eventDraftSchema.parse(input);
  if(draft.graphic)validateGraphic(draft.graphic.data);
  return draft;
}
