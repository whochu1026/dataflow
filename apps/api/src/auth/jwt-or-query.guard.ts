import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthUser } from './auth-user';

/** Allows Bearer header or `?access_token=` (for EventSource). */
@Injectable()
export class JwtOrQueryGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
      query: { access_token?: string };
      user?: AuthUser;
    }>();
    const header = req.headers.authorization;
    const token =
      (header?.startsWith('Bearer ') ? header.slice(7) : null) ||
      req.query.access_token;
    if (!token) throw new UnauthorizedException();
    try {
      const payload = this.jwt.verify<{ sub: string; email: string; name: string }>(
        token,
      );
      req.user = { id: payload.sub, email: payload.email, name: payload.name };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
