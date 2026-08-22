import fs from 'fs/promises';
import * as userRepository from '../repositories/user.repository';
import * as userService from '../services/user.service';

jest.mock('fs/promises', () => ({
  unlink: jest.fn(),
}));

jest.mock('../repositories/user.repository', () => ({
  getPatientAvatarUrl: jest.fn(),
  getDoctorAvatarUrl: jest.fn(),
  updatePatientAvatar: jest.fn(),
  updateDoctorAvatar: jest.fn(),
}));

const mockedRepository = jest.mocked(userRepository);
const mockedUnlink = fs.unlink as jest.MockedFunction<typeof fs.unlink>;

describe('user.service avatar CRUD', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUnlink.mockResolvedValue(undefined);
    mockedRepository.updatePatientAvatar.mockResolvedValue(true);
    mockedRepository.updateDoctorAvatar.mockResolvedValue(true);
  });

  it('uploads a patient avatar and removes the replaced stored file', async () => {
    mockedRepository.getPatientAvatarUrl.mockResolvedValue('/uploads/old.png');

    await expect(userService.uploadAvatar('patient-1', 'patient', '/uploads/new.png')).resolves.toEqual({
      avatarUrl: '/uploads/new.png',
    });

    expect(mockedRepository.updatePatientAvatar).toHaveBeenCalledWith('patient-1', '/uploads/new.png');
    expect(mockedUnlink).toHaveBeenCalledWith(expect.stringContaining('old.png'));
  });

  it('uploads a doctor avatar through the doctor profile row', async () => {
    mockedRepository.getDoctorAvatarUrl.mockResolvedValue(null);

    await expect(userService.uploadAvatar('doctor-1', 'doctor', '/uploads/doctor.webp')).resolves.toEqual({
      avatarUrl: '/uploads/doctor.webp',
    });

    expect(mockedRepository.updateDoctorAvatar).toHaveBeenCalledWith('doctor-1', '/uploads/doctor.webp');
    expect(mockedUnlink).not.toHaveBeenCalled();
  });

  it('deletes a stored avatar after clearing the profile row', async () => {
    mockedRepository.getDoctorAvatarUrl.mockResolvedValue('/uploads/doctor.png');

    await expect(userService.deleteAvatar('doctor-1', 'doctor')).resolves.toEqual({
      previousUrl: '/uploads/doctor.png',
    });

    expect(mockedRepository.updateDoctorAvatar).toHaveBeenCalledWith('doctor-1', null);
    expect(mockedUnlink).toHaveBeenCalledWith(expect.stringContaining('doctor.png'));
  });

  it('throws when no matching profile row can be updated', async () => {
    mockedRepository.getPatientAvatarUrl.mockResolvedValue(null);
    mockedRepository.updatePatientAvatar.mockResolvedValue(false);

    await expect(userService.uploadAvatar('missing-user', 'patient', '/uploads/new.png')).rejects.toMatchObject({
      statusCode: 404,
      message: 'Profile not found',
    });

    expect(mockedUnlink).toHaveBeenCalledWith(expect.stringContaining('new.png'));
  });
});
