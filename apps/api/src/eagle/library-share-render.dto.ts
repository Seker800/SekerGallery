import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class LibraryShareRenderResultDto {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: ['PENDING', 'PROCESSING', 'READY', 'FAILED', 'CANCELLED'] })
  status!: 'PENDING' | 'PROCESSING' | 'READY' | 'FAILED' | 'CANCELLED';
  @ApiProperty({
    enum: ['QUEUED', 'READING', 'DECODING', 'ENCODING', 'READY', 'FAILED', 'CANCELLED'],
  })
  stage!: 'QUEUED' | 'READING' | 'DECODING' | 'ENCODING' | 'READY' | 'FAILED' | 'CANCELLED';
  @ApiProperty() elapsedMs!: number;
  @ApiPropertyOptional() renditionId?: string;
  @ApiPropertyOptional() contentUrl?: string;
  @ApiPropertyOptional() width?: number;
  @ApiPropertyOptional() height?: number;
  @ApiPropertyOptional() byteSize?: number;
  @ApiPropertyOptional() errorCode?: string;
  @ApiPropertyOptional() rendererOnline?: boolean;
  @ApiPropertyOptional() cached?: boolean;
}
